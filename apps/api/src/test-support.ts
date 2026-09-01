import {
  createDirectory,
  createUserDatabase,
  type Directory,
  USER_MIGRATIONS,
  type UserDatabase,
} from "@wiseroutine/db";
import { generateToken } from "./crypto";

/**
 * Test fixtures.
 *
 * Seeding goes through the same repositories and clients the application uses,
 * rather than raw SQL - with two schemas and a Date/number boundary, hand-written
 * SQL drifts silently.
 */

const DIRECTORY_URL = "http://127.0.0.1:41090";
const USER_URL = "http://127.0.0.1:41091";

export const directory = (): Directory =>
  createDirectory({ url: DIRECTORY_URL });
export const userDb = (): UserDatabase => createUserDatabase({ url: USER_URL });

export interface TestUser {
  userId: string;
  databaseName: string;
  token: string;
  headers: Record<string, string>;
}

/** A user with a live session, ready to make authenticated requests. */
export async function seedUser(
  overrides: Partial<{
    plan: "free" | "pro";
    timeZone: string;
    storeEventTitles: boolean;
    /**
     * How far through the migrations this user's database claims to be.
     *
     * Level with the running Worker by default, because the local database is
     * migrated once by the harness and re-running the set on every request
     * would only be slow. Pass 0 to test the catch-up itself.
     */
    schemaVersion: number;
  }> = {},
): Promise<TestUser> {
  const dir = directory();
  const userId = crypto.randomUUID();
  const databaseName = `wr-test-${userId.slice(0, 8)}`;
  const now = Date.now();

  await dir.user.create({
    data: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test User",
      timeZone: overrides.timeZone ?? "Europe/Rome",
      plan: overrides.plan ?? "free",
      storeEventTitles: overrides.storeEventTitles !== false,
      databaseName,
      // The local server has one database that already exists, so a test user
      // is ready immediately.
      databaseReady: true,
      schemaVersion: overrides.schemaVersion ?? USER_MIGRATIONS.length,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
  });

  // Written directly rather than through a sign-in, because signing in for
  // real would mean sending an email and provisioning a database per test.
  // Better Auth reads this row exactly as it would one it wrote itself.
  const token = generateToken();
  await dir.session.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: new Date(now + 86_400_000),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    },
  });

  return {
    userId,
    databaseName,
    token,
    headers: { authorization: `Bearer ${token}` },
  };
}

/**
 * Empty both databases.
 *
 * `turso dev` serves one database per instance, so every test user maps to the
 * same pair - tests that care about their own state must start from a clean
 * slate. The directory matters as much as the user database: rows keyed by a
 * fixed id (a webhook channel, say) collide with the previous test's leftovers.
 */
export async function resetDatabases(): Promise<void> {
  await Promise.all([resetUserDatabase(), resetDirectory()]);
}

/**
 * Empty the shared directory.
 *
 * Deleted child-first: the schema restricts rather than cascades on most of
 * these, so removing users before what points at them fails on the FK.
 */
export async function resetDirectory(): Promise<void> {
  // Retried once, because the previous test's request may still be writing.
  // `foreground` schedules its sync work in `waitUntil`, so a row referencing
  // a user can land after the response and between two of the deletes below -
  // and the user delete then fails the foreign key. One more pass clears what
  // arrived late; the request it came from is over by then.
  try {
    await emptyDirectory();
  } catch {
    await emptyDirectory();
  }
}

async function emptyDirectory(): Promise<void> {
  const dir = directory();
  await dir.watchChannel.deleteMany();
  await dir.scheduledWork.deleteMany();
  await dir.device.deleteMany();
  await dir.planGrant.deleteMany();
  await dir.subscription.deleteMany();
  await dir.session.deleteMany();
  await dir.account.deleteMany();
  await dir.user.deleteMany();
  await dir.verification.deleteMany();
  await dir.rateLimit.deleteMany();
  await dir.processedEvent.deleteMany();
}

/** Empty the shared user database. */
export async function resetUserDatabase(): Promise<void> {
  const db = userDb();
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
  await db.addon.deleteMany();
}

export async function seedActivity(
  overrides: Partial<{
    name: string;
    kind: string;
    minimumType: string;
    minimumValue: number;
    sessionMinutes: number;
    daysOfWeek: number;
    isActive: boolean;
    /** The addon that owns it. Null, as almost everything is, unless said. */
    ownerAddonId: string;
    /**
     * The activity type that runs it, as `addonId/typeKey`.
     *
     * The other, and far more common, way an activity depends on an addon: it
     * was created by the *user* from an addon's activity type, so nothing owns
     * it and the key is the only link.
     */
    presetKey: string;
  }> = {},
): Promise<string> {
  const db = userDb();
  const id = crypto.randomUUID();

  await db.activity.create({
    data: {
      id,
      name: overrides.name ?? "Eye rest",
      kind: overrides.kind ?? "recovery",
      isActive: overrides.isActive !== false,
      minimumType: overrides.minimumType ?? "countPerDay",
      minimumValue: overrides.minimumValue ?? 2,
      sessionMinutes: overrides.sessionMinutes ?? 10,
      daysOfWeek: overrides.daysOfWeek ?? 0b1111111,
      ...(overrides.ownerAddonId !== undefined
        ? { ownerAddonId: overrides.ownerAddonId }
        : {}),
      ...(overrides.presetKey !== undefined
        ? { presetKey: overrides.presetKey }
        : {}),
      createdAt: new Date(),
    },
  });

  return id;
}

export async function seedCalendar(): Promise<{
  connectionId: string;
  calendarId: string;
}> {
  const db = userDb();
  const connectionId = crypto.randomUUID();
  const calendarId = crypto.randomUUID();

  await db.calendarConnection.create({
    data: {
      id: connectionId,
      provider: "google",
      providerAccountId: crypto.randomUUID(),
      email: "cal@example.com",
      scopes: "",
      status: "active",
      createdAt: new Date(),
    },
  });

  await db.calendar.create({
    data: {
      id: calendarId,
      connectionId,
      providerCalendarId: `primary-${calendarId.slice(0, 8)}`,
      name: "Work",
      isPrimary: true,
      createdAt: new Date(),
    },
  });

  return { connectionId, calendarId };
}

/**
 * Noon tomorrow - a deterministic point inside a day that has not started yet,
 * so planning tests do not depend on the wall clock.
 *
 * It used to be `Date.now() + 86_400_000`, which is the same *time* tomorrow
 * rather than noon, and so depended on the wall clock in exactly the way this
 * comment says it does not. Run in the evening, the instant it returned fell
 * outside the seeded user\'s 08:00-18:00 window: a slot pinned there was
 * outside the day being planned, was not counted against the activity\'s
 * minimum, and "counts what is already on the day" failed - after six o\'clock,
 * every day, and never before it.
 *
 * Noon UTC rather than noon local, because the fixture user is in Europe/Rome
 * and the window is read in their zone: 12:00 UTC is 13:00 or 14:00 there, and
 * comfortably inside it either way.
 */
export function tomorrowNoon(): number {
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setUTCHours(12, 0, 0, 0);
  return tomorrow.getTime();
}
