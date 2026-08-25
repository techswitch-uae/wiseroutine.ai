import { exports as worker } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import {
  directory,
  resetUserDatabase,
  seedActivity,
  seedCalendar,
  seedUser,
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

// `turso dev` serves one database, so every test user shares it. Reset between
// tests so counts and lists start from a known state.
beforeEach(resetUserDatabase);

describe("health", () => {
  test("responds without auth", async () => {
    const response = await worker.default.fetch("http://api/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  // The gate `pnpm deploy:*` opens after uploading. The test environment is
  // deliberately half-configured — no Stripe, no Google — so this proves the
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
