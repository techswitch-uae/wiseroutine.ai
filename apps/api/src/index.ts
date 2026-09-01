import {
  abandonedSlots,
  autoSlotsToComplete,
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
import { trustedOrigins } from "./auth";
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
import { graceAction } from "./planning/grace";
import { app as appRoutes } from "./routes/app";
import { billing } from "./routes/billing";
import { connect } from "./routes/connect";
import { signin } from "./routes/signin";
import { testing } from "./routes/testing";
import {
  type SyncDeps,
  syncCalendar,
  syncWindowStart,
  WINDOW_BEHIND_DAYS,
} from "./sync/engine";
import { realignAfterSync } from "./sync/realign";
import { ensureWatch, type WatchDeps } from "./sync/watch";
import { webhooks } from "./webhooks";

const api = new Hono<App>();

/**
 * Who may talk to this API, credentials attached.
 *
 * Was `origin: (origin) => origin` - reflect whatever asked - which with
 * `credentials: true` meant any page on the web could put a credentialed
 * request to `/auth/*` and read the reply. The list is Better Auth's own, so
 * the two cannot disagree; see `trustedOrigins` in `auth.ts`.
 *
 * Runs before `withContext`, so it reads the raw bindings rather than the
 * resolved `ServerEnv`. `APP_URL` and `ENVIRONMENT` are plain vars, not
 * secrets, so they are strings on both.
 *
 * An origin that is not on the list gets no `Access-Control-Allow-Origin`
 * header at all rather than a denial - which is what CORS is: the browser
 * refuses to hand the answer over. A request with no `Origin` header is not a
 * browser and is left alone; `requireUser` is what stands behind it.
 */
api.use("*", (c, next) =>
  cors({
    origin: (origin) =>
      trustedOrigins(c.env).includes(origin) ? origin : null,
    credentials: true,
  })(c, next),
);
api.use("*", withContext);

api.get("/health", (c) => c.text("OK"));

/**
 * The gate `pnpm deploy:*` opens right after uploading.
 *
 * Resolves every Secrets Store binding and runs the full schema over the
 * result, so a secret that is absent, empty or the wrong shape fails the
 * deploy rather than the first request that happens to need it. The reason is
 * logged, not returned - which key is missing is not a stranger's business.
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

// Seeding for the browser tests. Refuses in production, and does not exist at
// all unless `E2E_SECRET` is configured - see routes/testing.ts.
api.route("/test", testing);

api.route("/connect", connect);
// Deliberately not under /auth: that prefix is Better Auth's, and these are
// ours - the ticket exchange that gets a browser-made session into the
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
 * a `renew_watch` row out as a sync - so the watch would never have been
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
 * no longer scan everyone at once - the directory says whose turn it is, and
 * this runs against that one person.
 */
/**
 * How far back the auto-mover looks.
 *
 * Generous enough to cover the longest grace an activity sets plus a sweep
 * that arrived late, and short enough that a slot placed at nine this morning
 * is left where it is rather than dragged to now and then marked missed.
 *
 * The grace itself is per activity and read from the slot - see `slotsPastGrace`.
 * This is only the horizon the query looks back over.
 */
const GRACE_WINDOW = 30 * MINUTE;

/**
 * How long past its end a started session may sit before it is called
 * abandoned.
 *
 * Long on purpose. A stretch someone is still doing, a session that ran over,
 * a lid shut for ten minutes - all of those are someone still in it, and
 * closing a session out from under them is worse than leaving it a while
 * longer. An hour past the end is none of those.
 */
const ABANDONED_AFTER = 60 * MINUTE;

async function sweepGrace(
  job: SyncJob,
  config: ServerEnv,
  now: number,
): Promise<number | undefined> {
  const db = createUserDatabase(userCredentials(config, job.databaseName));
  const due = await slotsPastGrace(db, now, 200, GRACE_WINDOW);

  for (const slot of due) {
    switch (graceAction(slot, now)) {
      /**
       * An activity that starts itself.
       *
       * The slot goes live at its own start time and is closed at its end by
       * `autoSlotsToComplete` below. It is never moved, whether or not it is
       * locked - moving something that has already begun is not a
       * rescheduling, it is a lie about what happened.
       */
      case "start":
        await setSlotStatus(
          db,
          {
            slotId: slot.id,
            status: "started",
            actor: "system",
            reasonCode: "auto_start",
          },
          now,
          newId,
        );
        break;

      case "leave":
        break;

      case "miss":
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
        break;

      case "move": {
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
        break;
      }
    }
  }

  // Close anything that started itself and has now run its length. Separate
  // from the loop above because these are `started`, not `planned` - a
  // different question asked of a different set of slots.
  const finished = await autoSlotsToComplete(db, now, 200);
  for (const slot of finished) {
    await setSlotStatus(
      db,
      {
        slotId: slot.id,
        status: "completed",
        actor: "system",
        reasonCode: "auto_complete",
      },
      now,
      newId,
    );
  }

  /**
   * Sessions someone started and never finished.
   *
   * The one status with nothing behind it. `auto` slots are closed by the pass
   * above and manual ones are closed from inside the session - so a window
   * shut mid-stretch left the row `started` for ever. Still drawn as "running
   * now" days later, still counted as scheduled, so the day never re-asked for
   * the session either.
   *
   * Recorded as missed, not completed, and this is the judgement call in here:
   * we know it was started and we do not know it was done. Inventing progress
   * in someone's own health record is the worse of the two mistakes, and the
   * missed list can say exactly what happened where a silent completion could
   * not. The reason code is what makes it reversible if that call is wrong.
   *
   * After the `auto` pass on purpose - by here, anything still `started` and an
   * hour past its end really was abandoned.
   */
  const abandoned = await abandonedSlots(db, now, 200, ABANDONED_AFTER);
  for (const slot of abandoned) {
    await setSlotStatus(
      db,
      {
        slotId: slot.id,
        status: "missed",
        actor: "system",
        reasonCode: "never_finished",
        reasonText: "started, then left running",
      },
      now,
      newId,
    );
  }

  // Come back in a minute while anything is still pending, otherwise back off.
  return due.length > 0 || finished.length > 0 || abandoned.length > 0
    ? now + MINUTE
    : now + 15 * MINUTE;
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

  // A revoked or reauth-needed connection is not a failure to retry - the user
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
      // Never reach back before the calendar was connected. The zone is only
      // known out here, which is why the floor is computed here and not in
      // the engine.
      windowStart: syncWindowStart(
        now,
        target.connectedAt,
        user?.timeZone ?? "UTC",
      ),
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
 * directory row - so renewal reschedules itself for as long as the calendar
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
   * Cron cannot schedule per user - a Worker gets a handful of triggers, not one
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
      // lost the calendar goes quiet with no error anywhere - the poll keeps
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
