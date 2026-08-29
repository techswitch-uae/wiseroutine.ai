import { Hono } from "hono";
import type { App } from "../context";
import { requireUser } from "../context";
import { generateToken } from "../crypto";
import { createUserDb } from "../env";

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
 * Why this exists at all: signing in is a code emailed to a real address, and
 * connecting a calendar is a consent screen on Google's servers. Neither can
 * be driven by a test, so the test needs a door of its own - and one door with
 * three locks is safer than the alternative everybody reaches for, which is
 * loosening the real sign-in until a test can get through it.
 */
export const testing = new Hono<App>();

testing.use("*", async (c, next) => {
  const env = c.get("env");
  const secret = env.E2E_SECRET;

  if (env.ENVIRONMENT === "production" || !secret) return c.notFound();
  if (c.req.header("x-e2e-key") !== secret) return c.notFound();

  await next();
});

/**
 * Empty both databases.
 *
 * Locally one libSQL database serves every user - `TURSO_USER_HOST` is an
 * http:// URL, so the per-user name is never resolved - which means scenarios
 * are not isolated from each other by default. The first run of this skeleton
 * proved it: a later test saw the calendars an earlier one had seeded, and
 * looked for a set-up module the app was right not to show.
 *
 * So a scenario starts from nothing, the same way the handler tests do. The
 * order is the order of the foreign keys.
 */
testing.post("/reset", async (c) => {
  const directory = c.get("directory");
  // Any name: locally they all resolve to the one database.
  const db = createUserDb(c.get("env"), "wr-e2e-reset");

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

  await directory.watchChannel.deleteMany();
  await directory.scheduledWork.deleteMany();
  await directory.device.deleteMany();
  await directory.planGrant.deleteMany();
  await directory.subscription.deleteMany();
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
    }>()
    .catch(() => ({}) as Record<string, never>);

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
      // Locally `TURSO_USER_HOST` is an http:// URL, so one database serves
      // every user and the name is never resolved. This would need real
      // provisioning anywhere else - which is another reason these routes stay
      // out of deployed environments.
      databaseName: `wr-e2e-${userId.slice(0, 8)}`,
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

  return c.json({ userId, token, email: `${userId}@e2e.invalid` });
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
