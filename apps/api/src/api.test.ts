import { exports as worker } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
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
