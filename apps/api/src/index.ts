import {
  completeWork,
  createDirectory,
  createUserDatabase,
  type DueWork,
  dueWork,
  failWork,
  getCalendarForSync,
  getUser,
  moveSlot,
  pruneEventsBefore,
  pruneProcessedEvents,
  scheduleWork,
  setSlotStatus,
  slotsPastGrace,
  type WorkKind,
  watchesExpiringBefore,
} from "@wiseroutine/db";
import type { PlanId } from "@wiseroutine/plans";
import { syncInterval } from "@wiseroutine/scheduler";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  type App,
  type Bindings,
  newId,
  type SyncJob,
  withContext,
} from "./context";
import {
  assertConfigured,
  directoryCredentials,
  resolveServerEnv,
  type ServerEnv,
  userCredentials,
} from "./env";
import { app as appRoutes } from "./routes/app";
import { billing } from "./routes/billing";
import { connect } from "./routes/connect";
import { signin } from "./routes/signin";
import { type SyncDeps, syncCalendar, WINDOW_BEHIND_DAYS } from "./sync/engine";
import { realignAfterSync } from "./sync/realign";
import { ensureWatch, type WatchDeps } from "./sync/watch";
import { webhooks } from "./webhooks";

const api = new Hono<App>();

api.use("*", cors({ origin: (origin) => origin, credentials: true }));
api.use("*", withContext);

api.get("/health", (c) => c.text("OK"));

/**
 * The gate `pnpm deploy:*` opens right after uploading.
 *
 * Resolves every Secrets Store binding and runs the full schema over the
 * result, so a secret that is absent, empty or the wrong shape fails the
 * deploy rather than the first request that happens to need it. The reason is
 * logged, not returned — which key is missing is not a stranger's business.
 */
api.get("/health/config", (c) => {
  try {
    assertConfigured(c.get("env"));
    return c.json({ ok: true, environment: c.get("env").ENVIRONMENT });
  } catch (error) {
    console.error("config check failed", error);
    return c.json({ ok: false }, 503);
  }
});

// Sign-in, sign-out and session lookup are Better Auth's own routes; it is
// mounted rather than wrapped so its endpoints stay exactly what its client
// expects. Connecting a calendar is deliberately *not* under /auth.
api.on(["GET", "POST"], "/auth/*", (c) => c.get("auth").handler(c.req.raw));

api.route("/connect", connect);
// Deliberately not under /auth: that prefix is Better Auth's, and these are
// ours — the ticket exchange that gets a browser-made session into the
// desktop app. See routes/signin.ts.
api.route("/signin", signin);
api.route("/webhooks", webhooks);
api.route("/billing", billing);
api.route("/", appRoutes);

api.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error("unhandled", error);
  return c.json({ error: "internal_error" }, 500);
});

const MINUTE = 60_000;
const DAY = 86_400_000;

/** How much work one cron tick fans out. Keeps a tick well inside its
 *  wall-clock budget and spreads load rather than stampeding the providers. */
const WORK_BATCH = 200;

/**
 * Every work kind must map to a job the consumer handles.
 *
 * This used to be `kind === "grace_sweep" ? ... : "sync-calendar"`, which sent
 * a `renew_watch` row out as a sync — so the watch would never have been
 * renewed even once something scheduled it. A total map means a new kind is a
 * type error rather than silently becoming a sync.
 */
const WORK_TO_JOB: Record<WorkKind, SyncJob["type"]> = {
  sync_calendar: "sync-calendar",
  renew_watch: "renew-watch",
  grace_sweep: "grace-sweep",
};

function clientIds(config: ServerEnv): SyncDeps["clientIds"] {
  return {
    google: {
      clientId: config.GOOGLE_CLIENT_ID ?? "",
      clientSecret: config.GOOGLE_CLIENT_SECRET ?? "",
    },
    microsoft: {
      clientId: config.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: config.MICROSOFT_CLIENT_SECRET ?? "",
    },
  };
}

/**
 * The grace-period sweep, inside one user's database.
 *
 * "Moves itself in 3 min if you don't start" has to fire whether or not the app
 * is open, so it is a server decision. With a database per user the sweep can
 * no longer scan everyone at once — the directory says whose turn it is, and
 * this runs against that one person.
 */
async function sweepGrace(
  job: SyncJob,
  config: ServerEnv,
  now: number,
): Promise<number | undefined> {
  const db = createUserDatabase(userCredentials(config, job.databaseName));
  const due = await slotsPastGrace(db, now, 200);

  for (const slot of due) {
    // Thrash cap: after two automatic moves in a day, stop guessing and let the
    // missed list ask the user instead.
    if (slot.autoMoveCount >= 2) {
      await setSlotStatus(
        db,
        {
          slotId: slot.id,
          status: "missed",
          actor: "system",
          reasonCode: "auto_move_limit",
          reasonText: "moved twice, then no gap appeared",
        },
        now,
        newId,
      );
      continue;
    }

    const duration = slot.endsAt - slot.startsAt;
    await moveSlot(
      db,
      {
        slotId: slot.id,
        startsAt: now + 5 * MINUTE,
        endsAt: now + 5 * MINUTE + duration,
        actor: "system",
        reasonCode: "grace_expired",
        reasonText: "not started in time",
      },
      now,
      newId,
    );
  }

  // Come back in a minute while anything is still pending, otherwise back off.
  return due.length > 0 ? now + MINUTE : now + 15 * MINUTE;
}

async function runSyncJob(
  job: SyncJob,
  config: ServerEnv,
  rootKey: string,
  now: number,
): Promise<number | undefined> {
  if (!job.targetId) return undefined;

  const db = createUserDatabase(userCredentials(config, job.databaseName));
  const target = await getCalendarForSync(db, job.targetId);

  // A revoked or reauth-needed connection is not a failure to retry — the user
  // has to reconnect, and hammering it just burns quota.
  if (target?.connectionStatus !== "active") return undefined;

  const directory = createDirectory(directoryCredentials(config));
  const user = await getUser(directory, job.userId);
  const deps: SyncDeps = {
    db,
    userId: job.userId,
    rootKey,
    clientIds: clientIds(config),
  };

  await syncCalendar(
    deps,
    {
      calendarId: target.calendarId,
      connectionId: target.connectionId,
      provider: target.provider,
      providerCalendarId: target.providerCalendarId,
      storeTitles: user?.storeEventTitles ?? true,
    },
    now,
    newId,
  );

  // Detecting the change is only half of it. Without this, a meeting dragged
  // onto a focus slot in Outlook is stored correctly and the slot stays put.
  if (user) {
    await realignAfterSync(
      {
        db,
        directory,
        userId: job.userId,
        plan: user.plan as PlanId,
        user: {
          timeZone: user.timeZone,
          dayStartMinutes: user.dayStartMinutes,
          dayEndMinutes: user.dayEndMinutes,
        },
      },
      now,
      newId,
    );
  }

  // Push notifications are what keep a calendar current; this poll only
  // catches the ones that never arrived. So how soon it runs again follows
  // whether anyone is actually looking.
  return now + syncInterval(user?.lastSeenAt?.getTime() ?? null, now);
}

/**
 * Renew (or open) a calendar's push channel.
 *
 * Returns when to come back, which `completeWork` writes onto the same
 * directory row — so renewal reschedules itself for as long as the calendar
 * stays connected.
 */
async function runWatchJob(
  job: SyncJob,
  config: ServerEnv,
  rootKey: string,
  now: number,
): Promise<number | undefined> {
  if (!job.targetId) return undefined;

  const db = createUserDatabase(userCredentials(config, job.databaseName));
  const target = await getCalendarForSync(db, job.targetId);

  // Nothing to keep alive for a connection the user has to repair first.
  if (target?.connectionStatus !== "active") return undefined;

  const deps: WatchDeps = {
    db,
    userId: job.userId,
    rootKey,
    clientIds: clientIds(config),
    directory: createDirectory(directoryCredentials(config)),
    apiUrl: config.API_URL,
  };

  return ensureWatch(
    deps,
    {
      calendarId: target.calendarId,
      connectionId: target.connectionId,
      provider: target.provider,
      providerCalendarId: target.providerCalendarId,
      storeTitles: true,
    },
    now,
    newId,
  );
}

export default {
  fetch: api.fetch,

  /**
   * The cron ticker.
   *
   * Cron cannot schedule per user — a Worker gets a handful of triggers, not one
   * per customer. And with a database per user it cannot scan for due work
   * either. So the directory's coordination table answers "what is due?" in one
   * indexed query, and this fans the answers out onto the queue.
   */
  async scheduled(
    event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    const now = Date.now();
    const config = await resolveServerEnv(
      env as unknown as Record<string, unknown>,
    );
    const directory = createDirectory(directoryCredentials(config));

    const work: DueWork[] = await dueWork(directory, now, WORK_BATCH);
    if (work.length > 0) {
      const jobs: SyncJob[] = [];
      for (const item of work) {
        const user = await getUser(directory, item.userId);
        if (!user) continue;
        jobs.push({
          type: WORK_TO_JOB[item.kind],
          workId: item.id,
          userId: item.userId,
          databaseName: user.databaseName,
          ...(item.targetId ? { targetId: item.targetId } : {}),
          reason: "cron",
        });
      }

      // sendBatch caps at 100 messages.
      for (let i = 0; i < jobs.length; i += 100) {
        await env.SYNC_QUEUE.sendBatch(
          jobs.slice(i, i + 100).map((body) => ({ body })),
        );
      }
    }

    // Nightly: age out old webhook keys. Per-user event retention runs inside
    // each user's own sync pass, since there is no shared table to sweep.
    if (event.cron.startsWith("0 3")) {
      ctx.waitUntil(pruneProcessedEvents(directory, now - 30 * DAY));

      // A channel is renewed from its own `scheduled_work` row. If one is ever
      // lost the calendar goes quiet with no error anywhere — the poll keeps
      // working, so nothing looks broken. This reconciles from the channels
      // themselves, which is the only record that cannot drift.
      ctx.waitUntil(
        (async () => {
          const expiring = await watchesExpiringBefore(
            directory,
            now + 2 * DAY,
            WORK_BATCH,
          );
          for (const watch of expiring) {
            await scheduleWork(
              directory,
              {
                userId: watch.userId,
                kind: "renew_watch",
                targetId: watch.calendarId,
                dueAt: now,
              },
              now,
              newId,
            );
          }
        })(),
      );
    }
  },

  /**
   * The work consumer.
   *
   * Queues rather than Workflows: Workflows bill per step, and at a few passes
   * per user per day that is two orders of magnitude more expensive for
   * identical work.
   */
  async queue(batch: MessageBatch<SyncJob>, env: Bindings) {
    const config = await resolveServerEnv(
      env as unknown as Record<string, unknown>,
    );
    const directory = createDirectory(directoryCredentials(config));
    const rootKey = config.TOKEN_ROOT_KEY ?? "";
    const now = Date.now();

    for (const message of batch.messages) {
      const job = message.body;

      try {
        const nextDueAt =
          job.type === "grace-sweep"
            ? await sweepGrace(job, config, now)
            : job.type === "renew-watch"
              ? await runWatchJob(job, config, rootKey, now)
              : await runSyncJob(job, config, rootKey, now);

        // Reschedule in the directory, or drop the marker if there is nothing
        // further to do. Forgetting this is how a calendar goes quiet.
        if (job.workId) {
          if (nextDueAt === undefined) {
            await completeWork(directory, job.workId, now + 24 * 60 * MINUTE);
          } else {
            await completeWork(directory, job.workId, nextDueAt);
          }
        }

        if (job.type === "sync-calendar" && job.targetId) {
          const db = createUserDatabase(
            userCredentials(config, job.databaseName),
          );
          await pruneEventsBefore(db, now - WINDOW_BEHIND_DAYS * DAY);
        }

        message.ack();
      } catch (error) {
        console.error("work failed", job.type, job.targetId, error);
        if (job.workId) {
          await failWork(directory, job.workId, now);
        } else {
          // A webhook-triggered job with no directory row still needs to come
          // back, so leave a marker rather than losing the change entirely.
          await scheduleWork(
            directory,
            {
              userId: job.userId,
              kind: "sync_calendar",
              ...(job.targetId ? { targetId: job.targetId } : {}),
              dueAt: now + 5 * MINUTE,
            },
            now,
            newId,
          );
        }
        message.retry();
      }
    }
  },
};
