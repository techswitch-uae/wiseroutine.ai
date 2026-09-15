import {
  type ActivityInput,
  createActivity,
  getCalendarForSync,
  placeSlot,
  userTransaction,
} from "@wiseroutine/db";
import {
  CORE_FEATURES,
  featureUserKey,
  parseFeatureOverrides,
} from "@wiseroutine/plans/features";
import {
  normaliseGoogleEvent,
  normaliseMicrosoftEvent,
} from "@wiseroutine/providers";
import { dayBounds, localDateOf } from "@wiseroutine/scheduler";
import { Hono } from "hono";
import type { App } from "../context";
import { requireUser, rootKey } from "../context";
import { generateToken } from "../crypto";
import { createUserDb } from "../env";
import { planDay } from "../planning/planDay";
import { syncCalendarAndRepair } from "../sync/engine";
import { providerTestReader, testingEnabled } from "../testing-runtime";

/**
 * Seeding, for the browser tests and nothing else.
 *
 * These routes mint sessions and write calendar data, which is exactly what an
 * attacker would want, so the gate matters more than the endpoints do. Three
 * separate locks, each sufficient on its own:
 *
 *   1. Production refuses, whatever else is true.
 *   2. Nothing exists unless `E2E_SECRET` is configured - it is unset in every
 *      deployed environment, so the routes are simply not there.
 *   3. Every call must present that secret.
 *
 * A miss on any of them is a 404 rather than a 403, because "this endpoint
 * does not exist here" is the honest answer and not a hint to keep guessing.
 *
 * Most scenarios seed auth/consent so they can focus on the day. Dedicated
 * authentication journeys instead use a controlled mail sink and the real
 * OTP verification/provisioning paths. Provider journeys replace transport,
 * not event ingestion or repair. The clocks and inspection helpers here have
 * the same three locks; production sign-in is never loosened for a test.
 */
export const testing = new Hono<App>();

testing.use("*", async (c, next) => {
  const env = c.get("env");
  const secret = env.E2E_SECRET;

  if (!testingEnabled(env)) return c.notFound();
  if (c.req.header("x-e2e-key") !== secret) return c.notFound();

  await next();
});

/**
 * Empty the directory and configured fixture databases.
 *
 * Ordinary fixtures share one local user database. Cross-account acceptance
 * explicitly opts into a second endpoint; neither database is shared with a
 * developer's data. Scenarios are still serial and reset before each test. The first run of this skeleton
 * proved it: a later test saw the calendars an earlier one had seeded, and
 * looked for a set-up module the app was right not to show.
 *
 * So a scenario starts from nothing, the same way the handler tests do. The
 * order is the order of the foreign keys.
 */
testing.post("/reset", async (c) => {
  const directory = c.get("directory");
  const env = c.get("env");
  let cursor: string | undefined;
  do {
    const keys = await c.env.CONFIG.list({ prefix: "e2e:", cursor });
    await Promise.all(keys.keys.map(({ name }) => c.env.CONFIG.delete(name)));
    cursor = keys.list_complete ? undefined : keys.cursor;
  } while (cursor);
  const databases = [createUserDb(env, "wr-e2e-reset")];
  if (env.E2E_SECOND_USER_URL)
    databases.push(createUserDb(env, "wr-e2e-secondary"));
  for (const db of databases) {
    await db.$executeRawUnsafe("DELETE FROM _slot_actions");
    await db.$executeRawUnsafe("DELETE FROM _captures");
    await db.$executeRawUnsafe("DELETE FROM _todo_file_chunks");
    await db.$executeRawUnsafe("DELETE FROM _todo_files");
    await db.$executeRawUnsafe(
      "UPDATE _event_privacy SET store_titles = 1 WHERE id = 1",
    );
    await db.slotEvent.deleteMany();
    await db.slot.deleteMany();
    await db.planRun.deleteMany();
    await db.activityWindow.deleteMany();
    await db.activity.deleteMany();
    await db.externalEvent.deleteMany();
    await db.calendarSyncState.deleteMany();
    await db.calendar.deleteMany();
    await db.oAuthToken.deleteMany();
    await db.calendarConnection.deleteMany();
    await db.reminder.deleteMany();
  }

  await directory.watchChannel.deleteMany();
  await directory.scheduledWork.deleteMany();
  await directory.device.deleteMany();
  await directory.planGrant.deleteMany();
  await directory.subscription.deleteMany();
  await directory.socialHandoff.deleteMany();
  await directory.session.deleteMany();
  await directory.account.deleteMany();
  await directory.user.deleteMany();
  await directory.verification.deleteMany();
  await directory.rateLimit.deleteMany();
  await directory.processedEvent.deleteMany();

  return c.body(null, 204);
});

/**
 * A signed-in user, without the email round trip.
 *
 * The session row is written directly, exactly as `test-support` does for the
 * handler tests - Better Auth reads one it did not write just the same. The
 * token comes back for the test to put in the browser's storage, which is
 * where the real sign-in would have left it.
 */
testing.post("/seed", async (c) => {
  const body = await c.req
    .json<{
      timeZone?: string;
      plan?: "free" | "pro";
      features?: unknown;
      secondUser?: boolean;
    }>()
    .catch(() => ({}) as Record<string, never>);

  if (body.secondUser && !c.get("env").E2E_SECOND_USER_URL)
    return c.text("Second test tenant is not configured", 400);
  const directory = c.get("directory");
  const now = c.get("now");
  const userId = crypto.randomUUID();
  const token = generateToken();

  await directory.user.create({
    data: {
      id: userId,
      email: `${userId}@e2e.invalid`,
      name: "E2E User",
      timeZone: body.timeZone ?? "Europe/Rome",
      plan: body.plan ?? "free",
      storeEventTitles: true,
      // Ordinary fixtures share the primary local endpoint. The explicitly
      // configured secondary tenant exercises independent datasets without
      // pretending to validate production Turso provisioning/routing.
      databaseName: body.secondUser
        ? "wr-e2e-secondary"
        : `wr-e2e-${userId.slice(0, 8)}`,
      databaseReady: true,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
  });

  await directory.session.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: new Date(now + 86_400_000),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
  });

  await c.env.CONFIG.put(
    featureUserKey(userId),
    JSON.stringify({
      ...CORE_FEATURES,
      ...parseFeatureOverrides(body.features ?? {}),
    }),
  );
  return c.json({ userId, token, email: `${userId}@e2e.invalid` });
});

/** A controlled mail sink; never an OTP bypass on the sign-in endpoint. */
testing.post("/mail", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  const mail = await c.env.CONFIG.get(
    `e2e:mail:${email.toLowerCase()}`,
    "json",
  );
  return mail ? c.json(mail) : c.notFound();
});
testing.post("/mail/expire", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  await c.get("directory").verification.updateMany({
    where: { identifier: `sign-in-otp-${email.toLowerCase()}` },
    data: { expiresAt: new Date(0) },
  });
  return c.body(null, 204);
});
testing.post("/infrastructure", async (c) => {
  const { provisionFailure } = await c.req.json<{
    provisionFailure: boolean;
  }>();
  await c.env.CONFIG.put(
    "e2e:provision-failure",
    String(provisionFailure === true),
  );
  return c.body(null, 204);
});
testing.post("/clock", async (c) => {
  const { now } = await c.req.json<{ now: number }>();
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()))
    return c.text("Invalid clock", 400);
  await c.env.CONFIG.put("e2e:clock", String(now));
  return c.body(null, 204);
});

// The same three test-only locks as seeding, plus account authentication.
testing.post("/features", requireUser, async (c) => {
  const flags = parseFeatureOverrides(await c.req.json());
  await c.env.CONFIG.put(
    featureUserKey(c.get("user").userId),
    JSON.stringify({ ...CORE_FEATURES, ...flags }),
  );
  return c.body(null, 204);
});

/** Previously saved one-off history, independent of routine demand. */
testing.post("/saved-slot", requireUser, async (c) => {
  const { title, startsAt } = await c.req.json<{
    title: string;
    startsAt: number;
  }>();
  const slot = await c.get("db").slot.create({
    data: {
      id: crypto.randomUUID(),
      activityId: null,
      title,
      kind: "recovery",
      status: "bucketed",
      startsAt: new Date(startsAt),
      endsAt: new Date(startsAt + 20 * 60_000),
      timeZone: c.get("user").timeZone,
      createdAt: new Date(startsAt),
    },
  });
  return c.json({ id: slot.id });
});
testing.post("/inspect", requireUser, async (c) => {
  const db = c.get("db");
  return c.json({
    slots: await db.slot.findMany(),
    events: await db.slotEvent.findMany(),
    planRuns: await db.planRun.count(),
  });
});

/** Deliver a provider response at the external boundary. The same engine and
 * repair orchestration as the queue worker owns persistence and movement. */
testing.post("/calendar/delta", requireUser, async (c) => {
  const { calendarId, events } = await c.req.json<{
    calendarId: string;
    events: Record<string, unknown>[];
  }>();
  const db = c.get("db");
  const target = await getCalendarForSync(db, calendarId);
  if (target?.connectionStatus !== "active") return c.notFound();
  const user = c.get("user");
  const now = c.get("now");
  const key = rootKey(c);
  await c.env.CONFIG.put(
    `e2e:calendar:${calendarId}`,
    JSON.stringify({
      events: events.map((event) =>
        target.provider === "google"
          ? normaliseGoogleEvent(event)
          : normaliseMicrosoftEvent(event),
      ),
      deletedIds: [],
      nextSyncToken: `e2e-${now}`,
    }),
  );
  const readPage = await providerTestReader(
    c.get("env"),
    c.env.CONFIG,
    calendarId,
  );
  const outcome = await syncCalendarAndRepair(
    {
      db,
      directory: c.get("directory"),
      userId: user.userId,
      rootKey: key,
      clientIds: {
        google: { clientId: "e2e", clientSecret: "e2e" },
        microsoft: { clientId: "e2e", clientSecret: "e2e" },
      },
      ...(readPage ? { readPage } : {}),
    },
    target,
    now,
    () => crypto.randomUUID(),
  );
  return c.json(outcome);
});

/** An established routine for scenarios that are not testing first-day setup.
 * New production activities start tomorrow; fixtures may begin with a routine
 * that already existed yesterday. Never a bypass on the production route. */
testing.post("/routine", requireUser, async (c) => {
  const {
    activity,
    place = true,
    pastUnplaced = 0,
    slotStartsAt,
  } = await c.req.json<{
    activity: ActivityInput;
    place?: boolean;
    pastUnplaced?: number;
    /** A previously accepted appointment, including one now in progress. */
    slotStartsAt?: number;
  }>();
  const now = c.get("now");
  const user = c.get("user");
  const newId = () => crypto.randomUUID();
  return userTransaction(c.get("db"), async (db) => {
    const id = await createActivity(
      db,
      {
        ...activity,
        kind: activity.kind ?? "recovery",
        minimumType: activity.minimumType ?? "countPerDay",
        minimumValue: activity.minimumValue ?? 1,
        sessionMinutes: activity.sessionMinutes ?? 10,
      },
      now - 86400000,
      newId,
    );
    const start = dayBounds(
      localDateOf(now, user.timeZone),
      user.timeZone,
      0,
      1440,
    ).start;
    const previous = dayBounds(
      localDateOf(start - 1, user.timeZone),
      user.timeZone,
      480,
      1080,
    ).start;
    for (let n = 0; n < Math.min(pastUnplaced, 12); n++)
      await db.slot.create({
        data: {
          id: newId(),
          activityId: id,
          title: activity.name,
          kind: activity.kind ?? "recovery",
          status: "bucketed",
          startsAt: new Date(previous),
          endsAt: new Date(previous + (activity.sessionMinutes ?? 10) * 60000),
          timeZone: user.timeZone,
          createdAt: new Date(previous),
        },
      });
    if (place && slotStartsAt !== undefined && Number.isFinite(slotStartsAt))
      await placeSlot(
        db,
        {
          activityId: id,
          title: activity.name,
          kind: activity.kind ?? "recovery",
          startsAt: slotStartsAt,
          endsAt: slotStartsAt + (activity.sessionMinutes ?? 10) * 60_000,
          timeZone: user.timeZone,
        },
        slotStartsAt - 60_000,
        newId,
      );
    else if (place)
      await planDay(
        db,
        {
          user,
          onDay: now,
          from: now,
          trigger: "user_request",
        },
        now,
        newId,
      );
    return c.json({ id }, 201);
  });
});

/**
 * A connected account with calendars and meetings on it.
 *
 * Stands in for the consent screen. The events are written straight into the
 * user's database rather than synced, because the point of a scenario is what
 * the app does with meetings that exist - not whether Google's API works.
 */
testing.post("/calendar", requireUser, async (c) => {
  const body = await c.req.json<{
    email?: string;
    provider?: "google" | "microsoft";
    calendars?: {
      name: string;
      isSelected?: boolean;
      isPrimary?: boolean;
      events?: { title: string; startsAt: number; endsAt: number }[];
    }[];
  }>();

  const db = c.get("db");
  const now = c.get("now");
  const connectionId = crypto.randomUUID();

  await db.calendarConnection.create({
    data: {
      id: connectionId,
      provider: body.provider ?? "google",
      providerAccountId: crypto.randomUUID(),
      email: body.email ?? "cal@e2e.invalid",
      scopes: "",
      status: "active",
      createdAt: new Date(now),
    },
  });

  const made: { id: string; name: string }[] = [];

  for (const calendar of body.calendars ?? []) {
    const calendarId = crypto.randomUUID();
    await db.calendar.create({
      data: {
        id: calendarId,
        connectionId,
        providerCalendarId: `e2e-${calendarId.slice(0, 8)}`,
        name: calendar.name,
        isPrimary: calendar.isPrimary ?? false,
        isSelected: calendar.isSelected !== false,
        createdAt: new Date(now),
      },
    });
    // A seeded calendar is standing in for one that has actually been read,
    // so it carries the state a read leaves behind. Without this the day has
    // no idea when it was last synced, and anything that reports freshness is
    // untestable rather than merely untested.
    await db.calendarSyncState.create({
      data: { calendarId, lastIncrementalAt: new Date(now) },
    });

    await c.env.CONFIG.put(
      `e2e:calendar:${calendarId}`,
      JSON.stringify({
        events: [],
        deletedIds: [],
        nextSyncToken: "e2e-initial",
      }),
    );
    made.push({ id: calendarId, name: calendar.name });

    for (const event of calendar.events ?? []) {
      await db.externalEvent.create({
        data: {
          id: crypto.randomUUID(),
          calendarId,
          providerEventId: crypto.randomUUID(),
          title: event.title,
          startsAt: new Date(event.startsAt),
          endsAt: new Date(event.endsAt),
          updatedAt: new Date(now),
        },
      });
    }
  }

  return c.json({ connectionId, calendars: made });
});
