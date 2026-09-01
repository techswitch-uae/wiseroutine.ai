import { exports as worker } from "cloudflare:workers";
import {
  abandonedSlots,
  autoSlotsToComplete,
  slotsPastGrace,
} from "@wiseroutine/db";
import { beforeEach, describe, expect, test } from "vitest";
import {
  accessTokenFor,
  syncWindowStart,
  WINDOW_BEHIND_DAYS,
} from "./sync/engine";
import {
  directory,
  resetDatabases,
  seedActivity,
  seedCalendar,
  seedUser,
  type TestUser,
  tomorrowNoon,
  userDb,
} from "./test-support";

/**
 * Handler tests in workerd, against two local libSQL servers.
 *
 * These cover the things unit tests cannot: that auth actually rejects, that a
 * plan limit is refused by the *server* rather than merely hidden in the UI,
 * that the two database tiers stay separate, and that the webhook handlers
 * behave under the timing and duplication rules the providers impose.
 */

// `turso dev` serves one database per instance, so every test user shares
// both. Reset between tests so counts, lists and fixed ids start from a known
// state.
beforeEach(resetDatabases);

describe("health", () => {
  test("responds without auth", async () => {
    const response = await worker.default.fetch("http://api/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  // The gate `pnpm deploy:*` opens after uploading. The test environment is
  // deliberately half-configured - no Stripe, no Google - so this proves the
  // check actually refuses rather than always passing.
  test("the config gate refuses an incomplete environment", async () => {
    const response = await worker.default.fetch("http://api/health/config");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });
});

describe("authentication", () => {
  test("a protected route refuses an anonymous request", async () => {
    const response = await worker.default.fetch("http://api/today");
    expect(response.status).toBe(401);
  });

  test("a garbage bearer token is refused", async () => {
    const response = await worker.default.fetch("http://api/today", {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(response.status).toBe(401);
  });

  test("a valid session identifies the user", async () => {
    const user = await seedUser();
    const response = await worker.default.fetch("http://api/auth/get-session", {
      headers: user.headers,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string; plan: string };
    };
    expect(body.user.id).toBe(user.userId);
    expect(body.user.plan).toBe("free");
  });

  // The plan is a server-owned column. If a signup body could set it, every
  // paywall in the app would be advisory.
  test("a sign-in body cannot set its own plan", async () => {
    const response = await worker.default.fetch(
      "http://api/auth/sign-in/email-otp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "impostor@example.com",
          otp: "000000",
          plan: "pro",
        }),
      },
    );

    expect(response.status).toBe(400);
    const row = await directory().user.findFirst({
      where: { email: "impostor@example.com" },
    });
    expect(row).toBeNull();
  });
});

describe("plan gating", () => {
  // The point of the test: the SERVER refuses. A gate that only exists in the
  // UI is not a gate.
  test("free is refused a third active activity", async () => {
    const user = await seedUser({ plan: "free" });
    await seedActivity({ name: "One" });
    await seedActivity({ name: "Two" });

    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Three", sessionMinutes: 10 }),
    });

    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: string; upsell: string };
    expect(body.error).toBe("plan_limit");
    expect(body.upsell).toBeTruthy();
  });

  test("a paused activity does not count against the limit", async () => {
    const user = await seedUser({ plan: "free" });
    await seedActivity({ name: "One" });
    await seedActivity({ name: "Paused", isActive: false });

    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Two", sessionMinutes: 10 }),
    });

    expect(response.status).toBe(201);
  });

  test("pro is not limited", async () => {
    const user = await seedUser({ plan: "pro" });
    for (let i = 0; i < 4; i++) await seedActivity({ name: `A${i}` });

    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fifth", sessionMinutes: 10 }),
    });

    expect(response.status).toBe(201);
  });

  test("free cannot request an adaptive replan", async () => {
    const user = await seedUser({ plan: "free" });
    const response = await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "calendar_change" }),
    });
    expect(response.status).toBe(402);
  });

  test("free can still plan its day on request", async () => {
    const user = await seedUser({ plan: "free" });
    await seedActivity();
    const response = await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request" }),
    });
    expect(response.status).toBe(200);
  });
});

describe("planning end to end", () => {
  test("a day with no meetings gets its sessions placed", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity({ minimumValue: 3, sessionMinutes: 10 });

    const planned = await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at: tomorrowNoon() }),
    });
    expect(planned.status).toBe(200);
    const result = (await planned.json()) as { placed: number };
    expect(result.placed).toBe(3);

    const today = await worker.default.fetch(
      `http://api/today?at=${tomorrowNoon()}`,
      {
        headers: user.headers,
      },
    );
    const body = (await today.json()) as { slots: unknown[] };
    expect(body.slots.length).toBe(result.placed);
  });

  /**
   * The reported bug: "place the rest for me" placed the lot.
   *
   * A session dragged onto the day by hand is pinned, so a replan keeps it -
   * but the demand was worked out from what had been *completed*, which a
   * placed-but-not-yet-done session is not. So a three-a-day activity with one
   * already on the timeline asked for three more and got a day with four.
   */
  test("counts what is already on the day against the day's minimum", async () => {
    const user = await seedUser({ plan: "free" });
    const activityId = await seedActivity({
      minimumValue: 3,
      sessionMinutes: 10,
    });
    const at = tomorrowNoon();

    const placed = await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId, startsAt: at }),
    });
    expect(placed.status).toBe(201);

    const planned = await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at }),
    });
    // Two, not three: the one already there is one of the three.
    expect(((await planned.json()) as { placed: number }).placed).toBe(2);

    const today = await worker.default.fetch(`http://api/today?at=${at}`, {
      headers: user.headers,
    });
    const body = (await today.json()) as { slots: unknown[] };
    expect(body.slots.length).toBe(3);
  });

  // Found while writing these tests: planning a day whose window has already
  // closed correctly places nothing. Pinned so it stays deliberate, and so the
  // suite does not quietly depend on what time it is run.
  test("a day whose window has already closed places nothing", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity({ minimumValue: 3 });

    const yesterday = Date.now() - 86_400_000;
    const response = await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at: yesterday }),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { placed: number }).placed).toBe(0);
  });

  // Every placement is attributable to a run, which is what makes solver
  // changes safe to ship: replay a real day and diff.
  test("planning records a plan run", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity();

    await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request" }),
    });

    const row = await userDb().planRun.findFirst({
      select: { engineVersion: true, inputsHash: true, trigger: true },
    });

    expect(row?.engineVersion).toBeTruthy();
    expect(row?.inputsHash).toBeTruthy();
    expect(row?.trigger).toBe("user_request");
  });

  // The lifecycle log is what screen 3d is built from, so it must exist from
  // the moment a slot is created.
  test("planning and acting on a slot both leave a lifecycle trail", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity({ minimumValue: 1 });

    await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at: tomorrowNoon() }),
    });

    const today = (await (
      await worker.default.fetch(`http://api/today?at=${tomorrowNoon()}`, {
        headers: user.headers,
      })
    ).json()) as { slots: { id: string }[] };
    const slotId = today.slots[0]?.id;
    expect(slotId).toBeDefined();

    await worker.default.fetch(`http://api/slots/${slotId}/start`, {
      method: "POST",
      headers: user.headers,
    });
    await worker.default.fetch(`http://api/slots/${slotId}/complete`, {
      method: "POST",
      headers: user.headers,
    });

    const events = await userDb().slotEvent.findMany({
      where: { slotId },
      orderBy: { at: "asc" },
      select: { type: true },
    });

    const types = events.map((row: { type: string }) => row.type);
    expect(types).toContain("planned");
    expect(types).toContain("started");
    expect(types).toContain("completed");
  });
});

/** The next noon that falls on a weekday, so a test never lands on a Saturday
 *  and blames the code for it. */
function weekdayNoon(): number {
  const at = new Date();
  at.setHours(12, 0, 0, 0);
  do {
    at.setDate(at.getDate() + 1);
  } while (at.getDay() === 0 || at.getDay() === 6);
  return at.getTime();
}

/**
 * Which hours the day shows.
 *
 * The pure part - deriving the three ranges and falling back to a sane one -
 * is covered in `dayRanges.test.ts`. These are the parts that need a real
 * request: that the window actually narrows what comes back, that the
 * meetings it excludes are reported rather than dropped, and that the server
 * refuses a range it could not honour.
 */
/**
 * A connection that cannot be read, and cannot be repaired by retrying.
 *
 * The queue's retry is for a provider having a bad minute. Anything the user
 * has to act on has to leave that loop, or it runs until someone reads a log.
 */
describe("archiving an activity", () => {
  /** Put a slot of any status on the day, the way a plan run would. */
  async function seedSlot(
    activityId: string,
    status: string,
    startsAt: number,
  ) {
    const id = crypto.randomUUID();
    await userDb().slot.create({
      data: {
        id,
        activityId,
        title: "Eye rest",
        kind: "recovery",
        startsAt: new Date(startsAt),
        endsAt: new Date(startsAt + 5 * 60_000),
        timeZone: "Europe/Rome",
        status,
        createdAt: new Date(),
      },
    });
    return id;
  }

  const archive = (user: TestUser, id: string) =>
    worker.default.fetch(`http://api/activities/${id}`, {
      method: "DELETE",
      headers: user.headers,
    });

  test("takes its unstarted slots off the day", async () => {
    const user = await seedUser();
    const activityId = await seedActivity();
    const later = await seedSlot(activityId, "planned", Date.now() + 3_600_000);

    const response = await archive(user, activityId);
    expect(((await response.json()) as { cancelled: number }).cancelled).toBe(
      1,
    );
    expect(
      (await userDb().slot.findUnique({ where: { id: later } }))?.status,
    ).toBe("cancelled");
  });

  /**
   * The line that matters. Deleting an activity today must not change what
   * happened last Tuesday - the missed list and every progress number are
   * built from these rows.
   */
  test("never edits history", async () => {
    const user = await seedUser();
    const activityId = await seedActivity();
    const yesterday = Date.now() - 86_400_000;
    const done = await seedSlot(activityId, "completed", yesterday);
    const missed = await seedSlot(activityId, "missed", yesterday);

    await archive(user, activityId);

    expect(
      (await userDb().slot.findUnique({ where: { id: done } }))?.status,
    ).toBe("completed");
    expect(
      (await userDb().slot.findUnique({ where: { id: missed } }))?.status,
    ).toBe("missed");
  });

  // Yanking the window away from someone mid-stretch is worse than one stray
  // completion, and it closes itself in a minute either way.
  test("lets a session that is already running finish", async () => {
    const user = await seedUser();
    const activityId = await seedActivity();
    const running = await seedSlot(activityId, "started", Date.now());

    await archive(user, activityId);

    expect(
      (await userDb().slot.findUnique({ where: { id: running } }))?.status,
    ).toBe("started");
  });

  // Cancelled, not deleted - so the log can still say why it went.
  test("records why each one went", async () => {
    const user = await seedUser();
    const activityId = await seedActivity();
    await seedSlot(activityId, "planned", Date.now() + 3_600_000);

    await archive(user, activityId);

    const event = await userDb().slotEvent.findFirst({
      where: { type: "cancelled" },
      select: { reasonCode: true, actor: true },
    });
    expect(event?.reasonCode).toBe("activity_archived");
    expect(event?.actor).toBe("user");
  });
});

describe("a grant running out", () => {
  const DAY = 86_400_000;

  /** Put a grant on a user the way `grantPlan` would, and cache the plan it
   *  produces - which is the state a live account is in mid-trial. */
  async function grant(userId: string, expiresAt: number | null) {
    const dir = directory();
    await dir.planGrant.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        plan: "pro",
        reason: "trial",
        grantedBy: "test",
        expiresAt: expiresAt === null ? null : new Date(expiresAt),
        createdAt: new Date(),
      },
    });
    await dir.user.update({
      where: { id: userId },
      data: {
        plan: "pro",
        planSource: "grant",
        planExpiresAt: expiresAt === null ? null : new Date(expiresAt),
      },
    });
  }

  test("a live trial still buys pro capabilities", async () => {
    const user = await seedUser({ plan: "free" });
    await grant(user.userId, Date.now() + 7 * DAY);
    // Free stops at two; a trial is pro, so the third is allowed.
    for (let i = 0; i < 3; i++) await seedActivity({ name: `A${i}` });

    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fourth", kind: "recovery" }),
    });
    expect(response.status).toBe(201);
  });

  /**
   * The cached `plan` column has to notice.
   *
   * `refreshUserPlan` is documented as never running on the hot path, which is
   * right for a subscription - its end always arrives as a Stripe webhook. A
   * trial has no webhook: nothing tells us the fourteenth day has passed. So
   * without the check in `requireUser` a trial would expire on paper and never
   * in practice, and this is the test that says so.
   */
  test("an expired trial is refused on the very next request", async () => {
    const user = await seedUser({ plan: "free" });
    await grant(user.userId, Date.now() - 1);
    for (let i = 0; i < 2; i++) await seedActivity({ name: `A${i}` });

    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Third", kind: "recovery" }),
    });
    expect(response.status).toBe(402);

    // And the column is corrected, not merely the one answer.
    const row = await directory().user.findUnique({
      where: { id: user.userId },
      select: { plan: true, planSource: true },
    });
    expect(row?.plan).toBe("free");
    expect(row?.planSource).toBe("default");
  });

  test("an expired trial does not take a paid subscription with it", async () => {
    const user = await seedUser({ plan: "free" });
    await grant(user.userId, Date.now() - 1);
    await directory().subscription.create({
      data: {
        userId: user.userId,
        stripeCustomerId: `cus_${user.userId.slice(0, 8)}`,
        stripeSubscriptionId: `sub_${user.userId.slice(0, 8)}`,
        status: "active",
        updatedAt: new Date(),
      },
    });
    for (let i = 0; i < 2; i++) await seedActivity({ name: `A${i}` });

    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Third", kind: "recovery" }),
    });
    expect(response.status).toBe(201);
  });
});

describe("placing a slot by hand", () => {
  /**
   * One instant per test, not one per call.
   *
   * `tomorrowNoon()` is derived from the wall clock, so calling it twice in a
   * test returns two numbers milliseconds apart - which is fine for planning
   * and fatal for an assertion that a slot did not move.
   */
  let at = 0;
  beforeEach(() => {
    at = tomorrowNoon();
  });

  test("places the activity at the time asked for, and pins it", async () => {
    const user = await seedUser({ plan: "free" });
    const activityId = await seedActivity({ sessionMinutes: 10 });

    const response = await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId, startsAt: at }),
    });

    expect(response.status).toBe(201);
    const slot = (await response.json()) as {
      startsAt: number;
      endsAt: number;
      isLocked: boolean;
    };
    expect(slot.startsAt).toBe(at);
    // No `endsAt` sent, so the activity's own session length decides it.
    expect(slot.endsAt).toBe(at + 10 * 60_000);
    // The free plan's promise: what you placed stays where you placed it.
    expect(slot.isLocked).toBe(true);
  });

  // What separates "you put this here and it did not happen" from "we placed
  // it and it did not fit", which is the whole point of the missed list.
  test("the placement is logged as the user's, not the system's", async () => {
    const user = await seedUser({ plan: "free" });
    const activityId = await seedActivity();

    await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId, startsAt: at }),
    });

    const event = await userDb().slotEvent.findFirst({
      select: { type: true, actor: true, reasonCode: true },
    });
    expect(event?.type).toBe("planned");
    expect(event?.actor).toBe("user");
    expect(event?.reasonCode).toBe("placed_by_hand");
  });

  // The client picks from gaps it computed a moment ago, and a meeting can
  // land in one between the picking and the pressing - so this has to be
  // decided here, against the events as they are now.
  test("refuses a time a meeting has since taken", async () => {
    const user = await seedUser({ plan: "free" });
    const activityId = await seedActivity({ sessionMinutes: 10 });
    const { calendarId } = await seedCalendar();

    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: crypto.randomUUID(),
        title: "Design review",
        startsAt: new Date(at),
        endsAt: new Date(at + 60 * 60_000),
        busyStatus: "busy",
        updatedAt: new Date(),
      },
    });

    const response = await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId, startsAt: at + 5 * 60_000 }),
    });

    expect(response.status).toBe(409);
    expect(await userDb().slot.count()).toBe(0);
  });

  test("refuses a paused activity rather than quietly reviving it", async () => {
    const user = await seedUser({ plan: "free" });
    const activityId = await seedActivity({ isActive: false });

    const response = await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId, startsAt: at }),
    });

    expect(response.status).toBe(409);
  });

  test("refuses an activity that is not there", async () => {
    const user = await seedUser({ plan: "free" });

    const response = await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId: "nope", startsAt: at }),
    });

    expect(response.status).toBe(404);
  });

  // A hand-placed slot is the one thing a replan must never touch.
  test("a replan leaves a hand-placed slot where it was put", async () => {
    const user = await seedUser({ plan: "pro" });
    const activityId = await seedActivity({
      minimumValue: 3,
      sessionMinutes: 10,
    });

    const placed = await worker.default.fetch("http://api/slots", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ activityId, startsAt: at }),
    });
    const { id } = (await placed.json()) as { id: string };

    await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at: at }),
    });

    const row = await userDb().slot.findUnique({ where: { id } });
    expect(row?.startsAt.getTime()).toBe(at);
  });
});

describe("a connection with nothing behind it", () => {
  test("a missing token row asks for a reconnection instead of retrying", async () => {
    const user = await seedUser();
    // Exactly the half-written state `/connect/:provider/callback` leaves if
    // it fails between upserting the connection and saving the tokens: a row
    // that says "active" with no `oauth_tokens` beside it.
    const { connectionId } = await seedCalendar();

    const deps = {
      db: userDb(),
      userId: user.userId,
      rootKey: "unused - this never reaches the crypto",
      clientIds: {
        google: { clientId: "", clientSecret: "" },
        microsoft: { clientId: "", clientSecret: "" },
      },
    };

    await expect(
      accessTokenFor(deps, connectionId, "google", Date.now()),
    ).rejects.toThrow(/No tokens/);

    // The status is what stops it: `runSyncJob` declines to retry anything
    // that is not active, and Calendars turns this into "reconnect".
    const row = await userDb().calendarConnection.findUnique({
      where: { id: connectionId },
    });
    expect(row?.status).toBe("needs_reauth");
  });
});

describe("day view hours", () => {
  /**
   * A user whose zone is the one this runtime is in.
   *
   * workerd runs in UTC, so `setHours` below writes UTC hours. Against the
   * default Europe/Rome that is a two-hour shift, and a meeting written as
   * "07:00, before the day starts" lands at 09:00 and inside the window - the
   * test would then be measuring the offset rather than the range.
   */
  const utcUser = () => seedUser({ timeZone: "UTC" });

  /** A meeting at a fixed hour of the user's day, in the zone above. */
  const meetingAt = async (
    calendarId: string,
    dayAt: number,
    hour: number,
    title: string,
  ) => {
    const at = new Date(dayAt);
    at.setHours(hour, 0, 0, 0);
    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: `evt-${title}`,
        title,
        startsAt: at,
        endsAt: new Date(at.getTime() + 1_800_000),
        updatedAt: new Date(),
      },
    });
    return at.getTime();
  };

  type Day = {
    range: string;
    ranges: { key: string; label: string }[];
    meetings: { title: string }[];
    outside: { before: { title: string }[]; after: { title: string }[] };
  };

  const day = async (user: TestUser, at: number, range?: string) =>
    (await (
      await worker.default.fetch(
        `http://api/today?at=${at}${range ? `&range=${range}` : ""}`,
        { headers: user.headers },
      )
    ).json()) as Day;

  test("a meeting outside the range is reported, not dropped", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    const at = weekdayNoon();

    // 07:00 is before the 08:00 the day starts at; 12:00 is inside it.
    await meetingAt(calendarId, at, 7, "Early");
    await meetingAt(calendarId, at, 12, "Standup");

    const working = await day(user, at);
    expect(working.range).toBe("working");
    expect(working.meetings.map((m) => m.title)).toEqual(["Standup"]);
    // The failure this guards: a day view that silently omits a meeting.
    expect(working.outside.before.map((m) => m.title)).toEqual(["Early"]);

    const full = await day(user, at, "full");
    expect(full.meetings.map((m) => m.title)).toEqual(["Early", "Standup"]);
    expect(full.outside.before).toEqual([]);
  });

  /**
   * Where the call is, carried through to the block that draws it.
   *
   * Both providers send it and the sync stores it - this is the half in
   * between, which used to end at the database: the column was written and
   * nothing ever read it back out.
   */
  test("a meeting carries its join link to the day", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    const at = weekdayNoon();
    const noon = new Date(at);
    noon.setHours(12, 0, 0, 0);

    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: "evt-call",
        title: "Design review",
        startsAt: noon,
        endsAt: new Date(noon.getTime() + 1_800_000),
        joinUrl: "https://meet.google.com/abc-defg-hij",
        updatedAt: new Date(),
      },
    });

    const today = (await (
      await worker.default.fetch(`http://api/today?at=${at}`, {
        headers: user.headers,
      })
    ).json()) as { meetings: { title: string; joinUrl: string | null }[] };

    expect(today.meetings).toHaveLength(1);
    expect(today.meetings[0]?.joinUrl).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
  });

  test("turning the setting off empties the edges rather than the day", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    const at = weekdayNoon();
    await meetingAt(calendarId, at, 7, "Early");

    await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ showOutsideRange: false }),
    });

    const working = await day(user, at);
    expect(working.outside).toEqual({ before: [], after: [] });
    // Still readable at full day - the setting hides the summary, not the
    // meeting.
    expect((await day(user, at, "full")).meetings).toHaveLength(1);
  });

  test("a saved custom range becomes a range the day can be asked for", async () => {
    const user = await utcUser();
    const at = weekdayNoon();

    expect((await day(user, at)).ranges.map((r) => r.key)).toEqual([
      "working",
      "full",
    ]);
    // Asking for one that does not exist falls back rather than failing.
    expect((await day(user, at, "custom")).range).toBe("working");

    const saved = await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({
        customRangeLabel: "  Studio evenings  ",
        customRangeStartMinutes: 17 * 60,
        customRangeEndMinutes: 22 * 60,
        dayOpensOn: "custom",
      }),
    });
    expect(saved.status).toBe(204);

    const opened = await day(user, at);
    expect(opened.range).toBe("custom");
    // Trimmed on the way in: the label is rendered in a picker row.
    expect(opened.ranges.at(-1)?.label).toBe("Studio evenings");
  });

  test("half a custom range is refused", async () => {
    const user = await seedUser();
    const patch = (body: unknown) =>
      worker.default.fetch("http://api/settings", {
        method: "PATCH",
        headers: { ...user.headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // A label with no hours would store a range `dayRanges` then refuses to
    // offer - the setting would appear to save and not exist.
    expect((await patch({ customRangeLabel: "Evenings" })).status).toBe(400);
    expect(
      (
        await patch({
          customRangeLabel: "Evenings",
          customRangeStartMinutes: 22 * 60,
          customRangeEndMinutes: 17 * 60,
        })
      ).status,
    ).toBe(400);
  });

  // The check that catches a window inverted across two separate saves, which
  // validating the patch alone would let through.
  test("the day's window is checked against the row, not the patch", async () => {
    const user = await seedUser();
    const response = await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: { ...user.headers, "content-type": "application/json" },
      // Ends at 07:00, against a start of 08:00 that is already stored.
      body: JSON.stringify({ dayEndMinutes: 7 * 60 }),
    });
    expect(response.status).toBe(400);
  });
});

describe("settings", () => {
  test("turning titles off erases the ones already stored", async () => {
    const user = await seedUser();
    const { calendarId } = await seedCalendar();

    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: "evt-1",
        title: "Salary review",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        updatedAt: new Date(),
      },
    });

    const response = await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ storeEventTitles: false }),
    });
    expect(response.status).toBe(204);

    const row = await userDb().externalEvent.findFirst({
      select: { title: true },
    });

    // The promise has to hold backwards, not just from now on.
    expect(row?.title).toBeNull();
  });

  test("deselecting a calendar takes its events off the day at once", async () => {
    const user = await seedUser();
    const { calendarId } = await seedCalendar();
    // A weekday, not simply tomorrow. `tomorrowNoon()` drifts with the wall
    // clock, and a day outside the user's working window has no room for a
    // meeting - so this test passed Monday to Thursday and failed on a Friday,
    // for a reason that had nothing to do with calendars.
    const start = weekdayNoon();

    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: "evt-deselect",
        title: "Standup",
        startsAt: new Date(start),
        endsAt: new Date(start + 1_800_000),
        updatedAt: new Date(),
      },
    });

    const dayAt = `http://api/today?at=${start}`;
    const before = await worker.default.fetch(dayAt, { headers: user.headers });
    expect(
      ((await before.json()) as { meetings: unknown[] }).meetings.length,
    ).toBe(1);

    const off = await worker.default.fetch(
      `http://api/calendars/${calendarId}`,
      {
        method: "PATCH",
        headers: { ...user.headers, "content-type": "application/json" },
        body: JSON.stringify({ isSelected: false }),
      },
    );
    expect(off.status).toBe(204);

    // The bug this covers: deselecting cancelled future syncs but left every
    // event already fetched in the table, so the meeting stayed on the day -
    // and kept blocking the planner - no matter how often it was refreshed.
    const after = await worker.default.fetch(dayAt, { headers: user.headers });
    expect(
      ((await after.json()) as { meetings: unknown[] }).meetings.length,
    ).toBe(0);

    // And re-selecting costs nothing: the rows were never deleted.
    await worker.default.fetch(`http://api/calendars/${calendarId}`, {
      method: "PATCH",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ isSelected: true }),
    });
    const again = await worker.default.fetch(dayAt, { headers: user.headers });
    expect(
      ((await again.json()) as { meetings: unknown[] }).meetings.length,
    ).toBe(1);
  });

  test("disconnecting an account takes its calendars and events with it", async () => {
    const user = await seedUser();
    const { calendarId, connectionId } = await seedCalendar();
    const start = tomorrowNoon();

    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: "evt-disconnect",
        title: "Standup",
        startsAt: new Date(start),
        endsAt: new Date(start + 1_800_000),
        updatedAt: new Date(),
      },
    });

    const gone = await worker.default.fetch(
      `http://api/connections/${connectionId}`,
      { method: "DELETE", headers: user.headers },
    );
    expect(gone.status).toBe(204);

    // Unlike deselecting, this one really does forget: holding someone's
    // meetings after they disconnected the account is the thing they asked us
    // to stop doing.
    expect(await userDb().externalEvent.count()).toBe(0);
    expect(await userDb().calendar.count()).toBe(0);
    expect(await userDb().calendarConnection.count()).toBe(0);

    const listed = await worker.default.fetch("http://api/calendars", {
      headers: user.headers,
    });
    const body = (await listed.json()) as { connections: unknown[] };
    expect(body.connections).toHaveLength(0);

    // A repeat press is done, not an error - the account is gone either way.
    const again = await worker.default.fetch(
      `http://api/connections/${connectionId}`,
      { method: "DELETE", headers: user.headers },
    );
    expect(again.status).toBe(204);
  });

  test("a day that ends before it starts is refused", async () => {
    const user = await seedUser();
    const response = await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ dayStartMinutes: 1000, dayEndMinutes: 400 }),
    });
    expect(response.status).toBe(400);
  });
});

describe("webhooks", () => {
  // Graph POSTs a validation token and demands a plain-text echo within 10 s.
  // Answered before touching storage so it cannot time out.
  test("Microsoft validation handshake echoes the token as plain text", async () => {
    const response = await worker.default.fetch(
      "http://api/webhooks/microsoft?validationToken=abc%20123",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("abc 123");
  });

  test("the lifecycle endpoint answers the same handshake", async () => {
    const response = await worker.default.fetch(
      "http://api/webhooks/microsoft/lifecycle?validationToken=xyz",
      { method: "POST" },
    );
    expect(await response.text()).toBe("xyz");
  });

  // Google's first message after opening a channel is a handshake, and it can
  // arrive before the watch call has even returned.
  test("Google's sync handshake is accepted, not treated as a change", async () => {
    const response = await worker.default.fetch("http://api/webhooks/google", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "unknown-channel",
        "x-goog-resource-state": "sync",
        "x-goog-message-number": "1",
      },
    });
    expect(response.status).toBe(200);
  });

  test("a Google notification with the wrong channel token is rejected", async () => {
    const user = await seedUser();
    const { calendarId } = await seedCalendar();

    // Routing lives in the directory: a webhook knows only a channel id, and
    // with a database per user we must resolve the user before opening one.
    await directory().watchChannel.create({
      data: {
        channelId: "chan-1",
        userId: user.userId,
        calendarId,
        provider: "google",
        secret: "the-real-secret",
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
      },
    });

    const response = await worker.default.fetch("http://api/webhooks/google", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "chan-1",
        "x-goog-channel-token": "wrong-secret",
        "x-goog-resource-state": "exists",
      },
    });
    expect(response.status).toBe(401);
  });

  test("an unsigned Stripe webhook is rejected", async () => {
    const response = await worker.default.fetch("http://api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }),
    });
    expect(response.status).toBe(400);
  });
});

/**
 * The ticket exchange that carries a browser-made session into the desktop
 * app. The OAuth round-trip itself cannot be exercised here - it needs a real
 * provider - so what is checked is everything around it: that a ticket is
 * required, that a redeemed or unknown one is refused without leaking which,
 * and that a provider this environment has no credentials for is a clean
 * refusal rather than a 500. The test environment deliberately has none.
 */
describe("social sign-in handoff", () => {
  test("an unknown provider is refused", async () => {
    const response = await worker.default.fetch(
      "http://api/signin/social/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "facebook" }),
      },
    );
    expect(response.status).toBe(400);
  });

  // The separation the whole design rests on: signing in with Google asks for
  // an identity and nothing else. If calendar scopes ever leak into this URL,
  // "sign in" silently becomes "hand over your calendar" - and the consent
  // screen would say so, months before anyone read this file.
  //
  // Whether a provider is configured depends on the environment, so both
  // answers are legitimate; what is never legitimate is a crash, or a consent
  // URL asking for more than an identity.
  test("signing in asks for an identity, never a calendar", async () => {
    const started = await worker.default.fetch(
      "http://api/signin/social/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      },
    );
    expect(started.status).toBe(200);
    const { url, ticket } = (await started.json()) as {
      url: string;
      ticket: string;
    };
    expect(ticket).toBeTruthy();

    // `start` no longer talks to the provider - it points at our own route, so
    // that the browser's navigation is what mints the consent URL.
    expect(new URL(url).pathname).toBe("/signin/social/go");

    const go = await worker.default.fetch(url, { redirect: "manual" });
    // 302 to the app means the provider is unconfigured here - a refusal, not
    // a crash, and nothing more to assert.
    const location = go.headers.get("location") ?? "";
    if (!location.startsWith("http://api")) {
      expect(go.status).toBe(302);
    } else {
      return;
    }

    const consent = new URL(location);
    const scope = consent.searchParams.get("scope") ?? "";
    expect(scope).not.toContain("calendar");
    // Its own callback, not the calendar flow's - two grants, two redirects.
    expect(consent.searchParams.get("redirect_uri")).toContain(
      "/auth/callback/google",
    );
    // Someone with a work and a personal account must get to choose.
    expect(consent.searchParams.get("prompt")).toBe("select_account");
  });

  /**
   * The regression that cost an afternoon.
   *
   * Better Auth binds the OAuth `state` to the browser with a signed cookie and
   * refuses the callback without it. Minting the consent URL from a route the
   * app calls by `fetch` sets that cookie on a cross-origin XHR response, which
   * the browser throws away - so consent completed and then died as
   * `state_mismatch`, with nothing in the logs and a valid-looking URL.
   *
   * The cookie must ride on the redirect the *browser* follows. This asserts
   * that, and that it is the state the consent URL actually carries.
   */
  test("the consent redirect carries the state cookie", async () => {
    const started = await worker.default.fetch(
      "http://api/signin/social/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      },
    );
    const { url } = (await started.json()) as { url: string };

    const go = await worker.default.fetch(url, { redirect: "manual" });
    const location = go.headers.get("location") ?? "";
    // Unconfigured provider in this environment - nothing to bind.
    if (location.startsWith("http://api")) return;

    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();

    const cookies = go.headers.getSetCookie();
    const stateCookie = cookies.find((cookie) => cookie.includes("state="));
    expect(stateCookie).toBeDefined();
    // Signed, so the cookie is `<state>.<signature>` - the state it commits to
    // has to be the one the provider will hand back.
    expect(stateCookie).toContain(state as string);
  });

  // A ticket nobody minted must not be able to start a consent flow.
  test("an unminted ticket cannot start a consent flow", async () => {
    const go = await worker.default.fetch(
      "http://api/signin/social/go?ticket=never-minted",
      { redirect: "manual" },
    );
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toContain("signin=failed");
  });

  test("a claim without a ticket is refused", async () => {
    const response = await worker.default.fetch(
      "http://api/signin/social/claim",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(400);
  });

  // Unknown, expired and already-redeemed are one answer on purpose: telling
  // them apart would tell someone guessing tickets that they had found a real
  // one.
  test("an unknown ticket reads as expired", async () => {
    const response = await worker.default.fetch(
      "http://api/signin/social/claim",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: "not-a-ticket-anyone-minted" }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "expired" });
  });

  // The landing has nothing to park a session against without one, and must
  // not fall through into an unhandled error.
  test("the callback landing survives a missing ticket", async () => {
    const response = await worker.default.fetch(
      "http://api/signin/social/finish",
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("signin=failed");
  });
});

/**
 * Activities repeat, and nothing is written ahead for them.
 *
 * The alternative - filling days into the table as far forward as anyone might
 * look - is a plan nobody has seen going stale on disk. So a day is planned
 * the first time it is opened, and these are the rules that makes: planned
 * once, not re-planned, not re-planned for something added later in the day,
 * never for a day that is over, and never for an account with nothing to
 * place.
 */
describe("planning a day on open", () => {
  /**
   * Filling the day in without being asked is a Pro behaviour.
   *
   * It used to happen for everyone, which undercut the pricing line it is
   * meant to be selling: a day that is already placed by the time you look at
   * it makes "Pro does the placing" an offer of something you already have.
   */
  const open = async (user: TestUser, at: number) =>
    worker.default.fetch(`http://api/today?at=${at}`, {
      headers: user.headers,
    });

  /** Tomorrow, so the day under test has not ended whatever time this runs. */
  const AHEAD = () => tomorrowNoon();

  const slotsOf = async (response: Response) =>
    ((await response.json()) as { slots: { title: string }[] }).slots;

  test("a day plans itself the first time it is opened", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity({ name: "Eye rest", minimumValue: 2 });

    const slots = await slotsOf(await open(user, AHEAD()));
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.title === "Eye rest")).toBe(true);
  });

  test("an activity added after the day was filled waits to be placed", async () => {
    const user = await seedUser({ plan: "pro" });
    const at = AHEAD();

    await seedActivity({ name: "Eye rest", minimumValue: 1 });
    expect(await slotsOf(await open(user, at))).toHaveLength(1);

    // This used to place it on the next look, which meant adding an activity
    // in the morning and finding it already on the day by the time you walked
    // back to Today. The day is filled once, at the start of it; what is
    // added afterwards is owed, and the "To place today" module offers it
    // with a button rather than arranging it behind your back.
    await seedActivity({ name: "Shoulder stretch", minimumValue: 1 });
    const slots = await slotsOf(await open(user, at));
    expect(slots.map((s) => s.title)).toEqual(["Eye rest"]);

    // And it is still owed, so the module has something to offer.
    const owed = (await (await open(user, at)).json()) as {
      progress: { name: string; scheduled: number }[];
    };
    expect(
      owed.progress.find((row) => row.name === "Shoulder stretch")?.scheduled,
    ).toBe(0);
  });

  test("an activity that does not run today does not drag the day into a replan", async () => {
    const user = await seedUser({ plan: "pro", timeZone: "Europe/Rome" });
    const at = AHEAD();
    const weekday = new Date(
      new Date(at).toLocaleString("en-US", { timeZone: "Europe/Rome" }),
    ).getDay();

    await seedActivity({ name: "Eye rest", minimumValue: 1 });
    await open(user, at);

    // Never due, so never missing - otherwise a Sunday-only activity would
    // have every other day of the week re-planning itself forever.
    await seedActivity({
      name: "Weekly walk",
      daysOfWeek: 0b1111111 & ~(1 << weekday),
    });
    await open(user, at);
    expect(await userDb().planRun.count()).toBe(1);
  });

  test("opening it again does not plan it again", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity();

    const at = AHEAD();
    await open(user, at);
    await open(user, at);

    // Two runs would mean every load re-decides a day the user may already
    // have moved things around in.
    expect(await userDb().planRun.count()).toBe(1);
  });

  test("a day wholly behind us is left alone", async () => {
    const user = await seedUser({ plan: "pro" });
    await seedActivity();

    // History is not replanned. Today after working hours still is - the whole
    // working day is placed whatever the clock says, so someone opening the
    // app in the evening sees the shape their day was meant to have.
    await open(user, Date.now() - 2 * 86_400_000);
    expect(await userDb().planRun.count()).toBe(0);
  });

  test("an account with nothing to place is not marked as planned", async () => {
    const user = await seedUser({ plan: "pro" });
    const at = AHEAD();

    // Otherwise the empty run files itself against today and an activity added
    // a minute later would not appear until tomorrow.
    await open(user, at);
    expect(await userDb().planRun.count()).toBe(0);

    await seedActivity({ minimumValue: 1 });
    expect(await slotsOf(await open(user, at))).toHaveLength(1);
  });

  test("an activity is not placed on a day it does not run on", async () => {
    const user = await seedUser({ plan: "pro", timeZone: "Europe/Rome" });
    const at = AHEAD();

    // Every day except the one being opened, so the only thing under test is
    // the mask - not the window, the calendar, or the count.
    const weekday = new Date(
      new Date(at).toLocaleString("en-US", { timeZone: "Europe/Rome" }),
    ).getDay();
    await seedActivity({ daysOfWeek: 0b1111111 & ~(1 << weekday) });

    expect(await slotsOf(await open(user, at))).toHaveLength(0);
  });
});

describe("a free day is left as the user left it", () => {
  const open = async (user: TestUser, at: number) =>
    worker.default.fetch(`http://api/today?at=${at}`, {
      headers: user.headers,
    });

  test("opening the day places nothing", async () => {
    const user = await seedUser({ plan: "free" });
    await seedActivity({ minimumValue: 3 });

    const response = await open(user, tomorrowNoon());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { slots: unknown[] }).slots).toEqual([]);
  });

  // The day is still fillable - on request, which is the whole difference.
  test("asking for it fills it", async () => {
    const user = await seedUser({ plan: "free" });
    await seedActivity({ minimumValue: 3 });

    const planned = await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at: tomorrowNoon() }),
    });
    expect(((await planned.json()) as { placed: number }).placed).toBe(3);

    const after = await open(user, tomorrowNoon());
    expect(((await after.json()) as { slots: unknown[] }).slots.length).toBe(3);
  });

  // What the placement tray reads. Placed-but-not-done has to count against
  // the minimum, or it would keep asking for three more.
  test("what is left to place drops as slots are placed", async () => {
    const user = await seedUser({ plan: "free" });
    await seedActivity({ minimumValue: 3 });

    const before = await open(user, tomorrowNoon());
    const start = (await before.json()) as {
      progress: { scheduled: number; count: number; minimumValue: number }[];
    };
    expect(start.progress[0]?.scheduled).toBe(0);

    await worker.default.fetch("http://api/plan", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ trigger: "user_request", at: tomorrowNoon() }),
    });

    const after = await open(user, tomorrowNoon());
    const filled = (await after.json()) as {
      progress: { scheduled: number }[];
    };
    expect(filled.progress[0]?.scheduled).toBe(3);
  });
});

/**
 * A library activity keeps its behaviour across a round trip.
 *
 * `createActivity` builds its row field by field, so a column missing from
 * that list is a column silently never written - and that is what happened to
 * all four module columns. Nothing failed: the activity saved, the form
 * closed, and it came back a plain slot with no session to run and nothing
 * for the sheet to show when it was reopened. A test at the boundary, because
 * the boundary is where it went wrong.
 */
describe("an activity's behaviour survives being saved", () => {
  test("what goes in comes back out", async () => {
    const user = await seedUser();
    const created = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Eye rest",
        presetKey: "eye_rest",
        sessionEnabled: true,
        startPolicy: "auto",
        configJson: '{"metres":6}',
      }),
    });
    expect(created.status).toBe(201);

    const listed = await worker.default.fetch("http://api/activities", {
      headers: user.headers,
    });
    const rows = (await listed.json()) as {
      name: string;
      presetKey: string | null;
      sessionEnabled: boolean;
      startPolicy: string;
      configJson: string | null;
    }[];

    expect(rows.find((r) => r.name === "Eye rest")).toMatchObject({
      presetKey: "eye_rest",
      sessionEnabled: true,
      startPolicy: "auto",
      configJson: '{"metres":6}',
    });
  });

  // The session's identity travels on the slot, or nothing on the day knows
  // which module to run when it starts.
  test("the slot it produces names the module that runs it", async () => {
    const user = await seedUser({ plan: "pro" });
    await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Eye rest",
        minimumValue: 1,
        presetKey: "eye_rest",
        startPolicy: "auto",
      }),
    });

    const day = await worker.default.fetch(
      `http://api/today?at=${tomorrowNoon()}`,
      { headers: user.headers },
    );
    const { slots } = (await day.json()) as {
      slots: { presetKey: string | null; startPolicy: string }[];
    };
    expect(slots[0]).toMatchObject({
      presetKey: "eye_rest",
      startPolicy: "auto",
    });
  });
});

describe("which days an activity runs on", () => {
  test("an activity that runs on no day is refused", async () => {
    const user = await seedUser();
    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Never", daysOfWeek: 0 }),
    });

    // The planner would place it on no day and say nothing, which is the
    // quietest possible failure.
    expect(response.status).toBe(400);
  });

  test("a mask wider than a week is refused", async () => {
    const user = await seedUser();
    const response = await worker.default.fetch("http://api/activities", {
      method: "POST",
      headers: { ...user.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Eight days a week", daysOfWeek: 255 }),
    });
    expect(response.status).toBe(400);
  });

  // "To place today" is built from `progress`, so a Sunday-only walk showing
  // up as owed on a Tuesday is an offer the planner would then correctly
  // refuse to fill - a button that visibly does nothing.
  test("one that does not run today owes nothing today", async () => {
    const user = await seedUser({ plan: "free", timeZone: "Europe/Rome" });
    const at = tomorrowNoon();
    const weekday = new Date(
      new Date(at).toLocaleString("en-US", { timeZone: "Europe/Rome" }),
    ).getDay();

    await seedActivity({ name: "Eye rest" });
    await seedActivity({
      name: "Sunday walk",
      daysOfWeek: 0b1111111 & ~(1 << weekday),
    });

    const day = await worker.default.fetch(`http://api/today?at=${at}`, {
      headers: user.headers,
    });
    const { progress } = (await day.json()) as { progress: { name: string }[] };
    expect(progress.map((row) => row.name)).toEqual(["Eye rest"]);
  });
});

/**
 * The auto-mover's reach.
 *
 * "Moves itself in 3 min if you don't start" is about a slot whose moment is
 * passing right now. The query had no lower bound at all, which only became
 * visible once a day started being planned from its own beginning rather than
 * from the current time: every slot placed this morning was due, and the sweep
 * would drag them all to now+5, twice, and then call them missed.
 */
describe("the grace sweep's window", () => {
  const seedSlot = async (title: string, startsAt: number) => {
    await userDb().slot.create({
      data: {
        id: crypto.randomUUID(),
        title,
        kind: "recovery",
        startsAt: new Date(startsAt),
        endsAt: new Date(startsAt + 600_000),
        timeZone: "UTC",
        status: "planned",
        createdAt: new Date(),
      },
    });
  };

  test("reaches a slot just past its moment, and not one from this morning", async () => {
    const now = Date.now();
    await seedSlot("Two minutes ago", now - 2 * 60_000);
    await seedSlot("This morning", now - 9 * 3_600_000);
    await seedSlot("Later", now + 60_000);

    const due = await slotsPastGrace(userDb(), now, 200, 30 * 60_000);
    expect(due.map((slot) => slot.title)).toEqual(["Two minutes ago"]);
  });
});

/**
 * The one status with nothing behind it.
 *
 * An `auto` slot is closed at its end by the sweep; a manual one is closed
 * from inside the session. Neither covers the case where somebody presses
 * Start and then shuts the window - and until this, nothing did: the row
 * stayed `started` for ever, drawn as "running now" days later and counted as
 * scheduled, so the day never asked for the session again either.
 */
describe("a session that was started and never finished", () => {
  const HOUR = 3_600_000;

  const startedSlot = async (
    activityId: string | null,
    endsAt: number,
    minutes = 5,
  ) => {
    const id = crypto.randomUUID();
    await userDb().slot.create({
      data: {
        id,
        ...(activityId ? { activityId } : {}),
        title: "Breathing",
        kind: "recovery",
        startsAt: new Date(endsAt - minutes * 60_000),
        endsAt: new Date(endsAt),
        timeZone: "UTC",
        status: "started",
        createdAt: new Date(),
      },
    });
    return id;
  };

  test("the auto pass does not reach a manual one, which is the hole", async () => {
    await seedUser();
    // `manual` is the schema default, and what every hand-started activity is.
    const activityId = await seedActivity();
    await startedSlot(activityId, Date.now() - 24 * HOUR);

    expect(await autoSlotsToComplete(userDb(), Date.now(), 200)).toHaveLength(
      0,
    );
  });

  test("is collected once it is well past its end", async () => {
    await seedUser();
    const activityId = await seedActivity();
    const yesterday = await startedSlot(activityId, Date.now() - 24 * HOUR);

    const found = await abandonedSlots(userDb(), Date.now(), 200, HOUR);
    expect(found.map((slot) => slot.id)).toEqual([yesterday]);
  });

  /**
   * The line that protects someone mid-stretch. A session that ran over, or a
   * lid shut for ten minutes, is a person still doing the activity - closing
   * it out from under them is worse than leaving it a while longer.
   */
  test("is left alone while it could still be someone in it", async () => {
    await seedUser();
    const activityId = await seedActivity();
    await startedSlot(activityId, Date.now() - 10 * 60_000);
    await startedSlot(activityId, Date.now() + 60_000);

    expect(await abandonedSlots(userDb(), Date.now(), 200, HOUR)).toHaveLength(
      0,
    );
  });

  test("only ever collects the started ones", async () => {
    const user = await seedUser();
    const activityId = await seedActivity();
    const long = Date.now() - 24 * HOUR;
    const started = await startedSlot(activityId, long);

    for (const status of ["completed", "skipped", "missed", "planned"]) {
      await userDb().slot.create({
        data: {
          id: crypto.randomUUID(),
          activityId,
          title: status,
          kind: "recovery",
          startsAt: new Date(long - 60_000),
          endsAt: new Date(long),
          timeZone: "UTC",
          status,
          createdAt: new Date(),
        },
      });
    }

    const found = await abandonedSlots(userDb(), Date.now(), 200, HOUR);
    expect(found.map((slot) => slot.id)).toEqual([started]);
    expect(user).toBeTruthy();
  });

  /** The client's own escape hatch, which has to keep working on a slot this
   *  old - it is the only way to correct the record by hand. */
  test("can still be closed by hand, however long it has been sitting", async () => {
    const user = await seedUser();
    const activityId = await seedActivity();
    const id = await startedSlot(activityId, Date.now() - 24 * HOUR);

    const response = await worker.default.fetch(
      `http://api/slots/${id}/complete`,
      {
        method: "POST",
        headers: user.headers,
        body: JSON.stringify({ at: Date.now() }),
      },
    );

    expect(response.status).toBe(204);
    expect((await userDb().slot.findUnique({ where: { id } }))?.status).toBe(
      "completed",
    );
  });
});

/**
 * `GET /scope` - a run of local days, for the week and month views.
 *
 * What is worth testing here is not the shape but the two decisions the route
 * makes on its own: which events belong on a screen at all, and which local
 * day each one lands on. Both are places `/today` has been wrong before.
 */
describe("scope", () => {
  /** workerd runs in UTC; against the default Europe/Rome a "09:00" written
   *  with `setUTCHours` would land at 11:00 and the test would be measuring
   *  the offset. */
  const utcUser = () => seedUser({ timeZone: "UTC" });

  /** A day's midnight in UTC, `days` after the next weekday noon. */
  const midnight = (days: number): number => {
    const at = new Date(weekdayNoon());
    at.setUTCHours(0, 0, 0, 0);
    return at.getTime() + days * 86_400_000;
  };

  const iso = (at: number) => new Date(at).toISOString().slice(0, 10);

  const event = async (
    calendarId: string,
    title: string,
    startsAt: number,
    endsAt: number,
    extra: Record<string, unknown> = {},
  ) => {
    await userDb().externalEvent.create({
      data: {
        id: crypto.randomUUID(),
        calendarId,
        providerEventId: `evt-${title}-${crypto.randomUUID().slice(0, 8)}`,
        title,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        updatedAt: new Date(),
        ...extra,
      },
    });
  };

  type Scope = {
    timeZone: string;
    syncedAt: number | null;
    range: string;
    ranges: { key: string }[];
    meetingsFrom: number | null;
    days: {
      iso: string;
      dayStart: number;
      dayEnd: number;
      slots: { title: string }[];
      meetings: { title: string | null; startsAt: number; isAllDay: boolean }[];
    }[];
  };

  const scope = async (
    user: TestUser,
    from: string,
    days: number,
    range?: string,
  ) =>
    (await (
      await worker.default.fetch(
        `http://api/scope?from=${from}&days=${days}${
          range ? `&range=${range}` : ""
        }`,
        { headers: user.headers },
      )
    ).json()) as Scope;

  test("answers with the days asked for, in order, each with its own bounds", async () => {
    const user = await utcUser();
    const from = iso(midnight(0));

    const answer = await scope(user, from, 7);

    expect(answer.days).toHaveLength(7);
    expect(answer.days[0]?.iso).toBe(from);
    expect(answer.days[6]?.iso).toBe(iso(midnight(6)));
    expect(answer.days[0]?.dayEnd).toBe(answer.days[1]?.dayStart);
  });

  test("a meeting lands on its own local day, not on the one either side", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    await event(
      calendarId,
      "Standup",
      midnight(1) + 9 * 3_600_000,
      midnight(1) + 10 * 3_600_000,
    );

    const answer = await scope(user, iso(midnight(0)), 3);

    expect(answer.days.map((d) => d.meetings.length)).toEqual([0, 1, 0]);
    expect(answer.days[1]?.meetings[0]?.title).toBe("Standup");
  });

  test("a meeting running past midnight is listed under both days", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    await event(
      calendarId,
      "Long call",
      midnight(0) + 23 * 3_600_000,
      midnight(1) + 1 * 3_600_000,
    );

    const answer = await scope(user, iso(midnight(0)), 2);

    // Dropping it from the second day is the more surprising answer of the
    // two - the client clamps it to each column.
    expect(answer.days.map((d) => d.meetings.length)).toEqual([1, 1]);
  });

  test("all-day events are kept here, unlike on the day timeline", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    await event(calendarId, "Q3 planning", midnight(0), midnight(1), {
      isAllDay: true,
    });

    const answer = await scope(user, iso(midnight(0)), 1);

    expect(answer.days[0]?.meetings[0]).toMatchObject({
      title: "Q3 planning",
      isAllDay: true,
    });
  });

  test("a working location is not a meeting - the phantom-busy bug, on a week", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    await event(
      calendarId,
      "Office",
      midnight(0) + 9 * 3_600_000,
      midnight(0) + 18 * 3_600_000,
      { kind: "workingLocation" },
    );
    await event(
      calendarId,
      "Declined",
      midnight(0) + 11 * 3_600_000,
      midnight(0) + 12 * 3_600_000,
      { responseStatus: "declined" },
    );

    const answer = await scope(user, iso(midnight(0)), 1);

    expect(answer.days[0]?.meetings).toEqual([]);
  });

  test("the same meeting on two calendars is drawn once", async () => {
    const user = await utcUser();
    const work = await seedCalendar();
    const personal = await seedCalendar();
    const span = [midnight(0) + 9 * 3_600_000, midnight(0) + 10 * 3_600_000];

    for (const { calendarId } of [work, personal]) {
      await event(calendarId, "Review", span[0] as number, span[1] as number, {
        icalUid: "shared-uid",
      });
    }

    const answer = await scope(user, iso(midnight(0)), 1);

    expect(answer.days[0]?.meetings).toHaveLength(1);
  });

  test("a junk date falls back to today rather than to 1970", async () => {
    const user = await utcUser();

    const answer = await scope(user, "2026-02-31", 1);

    expect(answer.days[0]?.iso).toBe(iso(Date.now()));
  });

  test("the window is capped, so no caller can ask for a year of days", async () => {
    const user = await utcUser();

    const answer = await scope(user, iso(midnight(0)), 365);

    expect(answer.days).toHaveLength(42);
  });

  test("carries the hours picker, so the week can offer the same ranges", async () => {
    const user = await utcUser();

    const opens = await scope(user, iso(midnight(0)), 1);
    const full = await scope(user, iso(midnight(0)), 1, "full");

    expect(opens.range).toBe("working");
    expect(opens.ranges.map((r) => r.key)).toContain("full");
    // The picker answers for a week the same way it answers for a day - and
    // falls back rather than failing on one that no longer exists.
    expect(full.range).toBe("full");
    expect((await scope(user, iso(midnight(0)), 1, "gone")).range).toBe(
      "working",
    );
  });

  test("the days always cover midnight to midnight, whatever the range", async () => {
    const user = await utcUser();
    const { calendarId } = await seedCalendar();
    await event(
      calendarId,
      "Late",
      midnight(0) + 22 * 3_600_000,
      midnight(0) + 23 * 3_600_000,
    );

    // The range is the client's window, not the query's. Narrowing the read to
    // it would make "2 later" unanswerable - the meetings outside are exactly
    // the ones the query would have dropped.
    const working = await scope(user, iso(midnight(0)), 1, "working");
    expect(working.days[0]?.meetings).toHaveLength(1);
  });

  test("says when meetings start being known, and stays quiet with no calendar", async () => {
    const user = await utcUser();

    expect((await scope(user, iso(midnight(0)), 1)).meetingsFrom).toBeNull();

    await seedCalendar();
    const after = await scope(user, iso(midnight(0)), 1);
    expect(after.meetingsFrom).not.toBeNull();
  });

  test("refuses an anonymous request", async () => {
    const response = await worker.default.fetch("http://api/scope");
    expect(response.status).toBe(401);
  });
});

/**
 * How far back a sync reaches.
 *
 * The floor is the whole point: nothing from before a calendar was connected
 * is ever fetched. Pure arithmetic, so it is tested as arithmetic - the
 * provider round trip that would exercise it end to end proves nothing extra
 * about the one decision being made.
 */
describe("sync window", () => {
  const DAY = 86_400_000;
  const NOON = Date.UTC(2026, 7, 11, 12);

  test("a calendar connected today is not read back into last week", async () => {
    const start = syncWindowStart(NOON, NOON, "UTC");
    // Midnight of the connection day, so a calendar connected at noon still
    // shows that morning's meetings.
    expect(start).toBe(Date.UTC(2026, 7, 11));
  });

  test("once the rolling window has overtaken it, the floor stops applying", async () => {
    const connected = NOON - 30 * DAY;
    expect(syncWindowStart(NOON, connected, "UTC")).toBe(
      NOON - WINDOW_BEHIND_DAYS * DAY,
    );
  });

  test("the connection day is the account's, not UTC's", async () => {
    // 23:00 in Los Angeles on the 11th is already the 12th in UTC. Taking the
    // UTC day would put the floor after their own morning and cut it.
    const connected = Date.UTC(2026, 7, 12, 6);
    expect(syncWindowStart(connected, connected, "America/Los_Angeles")).toBe(
      Date.UTC(2026, 7, 11, 7),
    );
  });
});
