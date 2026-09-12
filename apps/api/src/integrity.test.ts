import { exports as worker } from "cloudflare:workers";
import {
  completeWork,
  dueWork,
  failWork,
  forgetStoredTitles,
  nextGraceDeadline,
  placeSlot,
  processWebhook,
  replacePlannedSlots,
  scheduleWork,
  setActivityWindows,
  setSlotStatus,
  upsertEvents,
  upsertSubscription,
} from "@wiseroutine/db";
import type Stripe from "stripe";
import { beforeEach, expect, test, vi } from "vitest";
import type { SyncJob } from "./context";
import type { ServerEnv } from "./env";
import { sweepGrace } from "./index";
import {
  directory,
  resetDatabases,
  seedActivity,
  seedCalendar,
  seedUser,
  testFeatures,
  tomorrowNoon,
  userDb,
} from "./test-support";
import { applyBillingEvent } from "./webhooks/billing";

beforeEach(async () => {
  await resetDatabases();
  await testFeatures("all");
});
const id = () => crypto.randomUUID();
async function slot() {
  return placeSlot(
    userDb(),
    {
      activityId: null,
      title: "Focus",
      kind: "focus",
      startsAt: tomorrowNoon(),
      endsAt: tomorrowNoon() + 600000,
      timeZone: "UTC",
    },
    Date.now(),
    id,
  );
}

test("privacy erases all details and a stale in-flight sync cannot restore them", async () => {
  await seedUser();
  const { calendarId } = await seedCalendar();
  const event = {
    providerEventId: "e",
    title: "Private",
    joinUrl: "https://meet.example/secret",
    description: "Confidential",
    startsAt: tomorrowNoon(),
    endsAt: tomorrowNoon() + 600000,
    isAllDay: false,
    kind: "default" as const,
    busyStatus: "busy" as const,
    responseStatus: "accepted" as const,
    isCancelled: false,
    changeTag: "1",
  };
  await upsertEvents(
    userDb(),
    { calendarId, storeTitles: true },
    [event],
    Date.now(),
    id,
  );
  await forgetStoredTitles(userDb());
  await upsertEvents(
    userDb(),
    { calendarId, storeTitles: true },
    [{ ...event, changeTag: "2" }],
    Date.now(),
    id,
  );
  expect(await userDb().externalEvent.findFirst()).toMatchObject({
    title: null,
    joinUrl: null,
    description: null,
  });
});

test("privacy endpoint erases unchanged events and redacts the day response", async () => {
  const user = await seedUser();
  const { calendarId } = await seedCalendar();
  // This tests privacy, not provider synchronization. Avoid a foreground sync
  // to the fixture's deliberately invalid provider credentials.
  await directory().user.update({
    where: { id: user.userId },
    data: { lastSeenAt: new Date() },
  });
  await userDb().calendar.update({
    where: { id: calendarId },
    data: { isSelected: true },
  });
  await upsertEvents(
    userDb(),
    { calendarId, storeTitles: true },
    [
      {
        providerEventId: "e",
        title: "Private",
        joinUrl: "https://meet.example/secret",
        description: "Confidential",
        startsAt: tomorrowNoon(),
        endsAt: tomorrowNoon() + 600000,
        isAllDay: false,
        kind: "default",
        busyStatus: "busy",
        responseStatus: "accepted",
        isCancelled: false,
        changeTag: "1",
      },
    ],
    Date.now(),
    id,
  );
  const response = await worker.default.fetch("http://api/settings", {
    method: "PATCH",
    headers: user.headers,
    body: JSON.stringify({ storeEventTitles: false }),
  });
  expect(response.status).toBe(204);
  const day = (await worker.default
    .fetch(`http://api/today?at=${tomorrowNoon()}`, { headers: user.headers })
    .then((r) => r.json())) as { meetings: unknown[] };
  expect(day.meetings[0]).toMatchObject({
    title: null,
    joinUrl: null,
    description: null,
  });
}, 15000); // Includes the cold workerd/auth startup, two requests, and real DB I/O.

test.each([
  { sessionMinutes: 0 },
  { sessionMinutes: -1 },
  { sessionMinutes: "10" },
  { minimumValue: 1e9 },
  { minimumValue: null },
  { importance: "urgent" },
  { preferredWindows: [1440] },
  { kind: "invalid" },
  { graceMinutes: -1 },
  { name: " " },
])("invalid activity input is refused before writing: %j", async (patch) => {
  const user = await seedUser({ plan: "pro" });
  const activityId = await seedActivity();
  for (const [url, method] of [
    ["http://api/activities", "POST"],
    [`http://api/activities/${activityId}`, "PATCH"],
  ] as const) {
    const response = await worker.default.fetch(url, {
      method,
      headers: user.headers,
      body: JSON.stringify(patch),
    });
    expect(response.status).toBe(400);
  }
  expect(await userDb().activity.count()).toBe(1);
  expect(
    await userDb().activity.findUnique({ where: { id: activityId } }),
  ).toMatchObject({ sessionMinutes: 10, minimumValue: 2 });
});

test("automatic planning leaves a durable grace marker on the first open", async () => {
  const user = await seedUser({ plan: "pro" });
  await seedActivity();
  const response = await worker.default.fetch(
    `http://api/today?at=${tomorrowNoon()}`,
    { headers: user.headers },
  );
  expect(response.status).toBe(200);
  expect(await userDb().slot.count()).toBeGreaterThan(0);
  expect(
    await directory().scheduledWork.findFirst({
      where: { userId: user.userId, kind: "grace_sweep" },
    }),
  ).not.toBeNull();
});

test("duplicate action delivery does not append events or undo a later completion", async () => {
  const user = await seedUser();
  const s = await slot();
  const request = (action: string, key: string) =>
    worker.default.fetch(`http://api/slots/${s.id}/${action}`, {
      method: "POST",
      headers: { ...user.headers, "idempotency-key": key },
      body: JSON.stringify({ at: Date.now() }),
    });
  expect((await request("start", "action-start")).status).toBe(204);
  expect((await request("complete", "action-complete")).status).toBe(204);
  expect((await request("start", "action-start")).status).toBe(204);
  expect(await userDb().slot.findUnique({ where: { id: s.id } })).toMatchObject(
    { status: "completed" },
  );
  expect(await userDb().slotEvent.count({ where: { slotId: s.id } })).toBe(3);
  expect((await request("skip", "action-start")).status).toBe(409);
});

test("failed lifecycle event rolls back status and idempotency key", async () => {
  const s = await slot();
  const db = userDb();
  await db.$executeRawUnsafe(
    "CREATE TRIGGER refuse_event BEFORE INSERT ON slot_events BEGIN SELECT RAISE(ABORT, 'event failed'); END",
  );
  try {
    await expect(
      setSlotStatus(
        db,
        { slotId: s.id, status: "completed", actor: "user", actionId: "retry" },
        Date.now(),
        id,
      ),
    ).rejects.toThrow();
    expect(await db.slot.findUnique({ where: { id: s.id } })).toMatchObject({
      status: "planned",
    });
    expect(await db.$queryRawUnsafe("SELECT * FROM _slot_actions")).toEqual([]);
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER refuse_event");
  }
  await setSlotStatus(
    db,
    { slotId: s.id, status: "completed", actor: "user", actionId: "retry" },
    Date.now(),
    id,
  );
  expect(await db.slot.findUnique({ where: { id: s.id } })).toMatchObject({
    status: "completed",
  });
});

test("failed plan replacement preserves the previous plan and history", async () => {
  const s = await slot();
  const db = userDb();
  await db.slot.update({ where: { id: s.id }, data: { isLocked: false } });
  await db.$executeRawUnsafe(
    "CREATE TRIGGER refuse_slot BEFORE INSERT ON slots BEGIN SELECT RAISE(ABORT, 'slot failed'); END",
  );
  try {
    await expect(
      replacePlannedSlots(
        db,
        { from: s.startsAt, to: s.endsAt, planRunId: "missing" },
        [
          {
            activityId: null,
            title: "Replacement",
            kind: "focus",
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            timeZone: "UTC",
          },
        ],
        Date.now(),
        id,
      ),
    ).rejects.toThrow();
    expect(await db.slot.findUnique({ where: { id: s.id } })).not.toBeNull();
    expect(await db.slotEvent.count()).toBe(1);
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER refuse_slot");
  }
});

test("replacing activity windows rolls back as one operation", async () => {
  const activityId = await seedActivity();
  const db = userDb();
  await setActivityWindows(db, activityId, [540], id);
  await db.$executeRawUnsafe(
    "CREATE TRIGGER refuse_window BEFORE INSERT ON activity_windows BEGIN SELECT RAISE(ABORT, 'window failed'); END",
  );
  try {
    await expect(
      setActivityWindows(db, activityId, [600], id),
    ).rejects.toThrow();
    expect(await db.activityWindow.findFirst()).toMatchObject({
      anchorMinutes: 540,
    });
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER refuse_window");
  }
});

test("partial subscription updates preserve subscription and cancellation metadata", async () => {
  const user = await seedUser();
  const now = Date.now();
  await upsertSubscription(
    directory(),
    {
      userId: user.userId,
      stripeCustomerId: "cus",
      stripeSubscriptionId: "sub",
      stripePriceId: "price",
      status: "active",
      currentPeriodEnd: now + 86400000,
      cancelAtPeriodEnd: true,
    },
    now,
  );
  await upsertSubscription(
    directory(),
    { userId: user.userId, stripeCustomerId: "cus", status: "past_due" },
    now,
  );
  expect(
    await directory().subscription.findUnique({
      where: { userId: user.userId },
    }),
  ).toMatchObject({
    stripeSubscriptionId: "sub",
    stripePriceId: "price",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date(now + 86400000),
  });
});

test("webhook failure rolls back business writes and remains retryable", async () => {
  const user = await seedUser();
  let attempts = 0;
  const apply = () =>
    processWebhook(directory(), "stripe", "evt", Date.now(), async (tx) => {
      await upsertSubscription(
        tx,
        { userId: user.userId, stripeCustomerId: "cus", status: "active" },
        Date.now(),
      );
      if (++attempts === 1) throw new Error("injected failure");
    });
  await expect(apply()).rejects.toThrow("injected failure");
  expect(await directory().subscription.count()).toBe(0);
  expect(await directory().processedEvent.count()).toBe(0);
  expect(await apply()).toBe(true);
  expect(await apply()).toBe(false);
  expect(attempts).toBe(2);
});

test("next deadline includes imminent auto starts and running session ends", async () => {
  const db = userDb();
  const now = Date.now();
  const activityId = await seedActivity();
  await db.activity.update({
    where: { id: activityId },
    data: { startPolicy: "auto" },
  });
  const s = await placeSlot(
    db,
    {
      activityId,
      title: "Auto",
      kind: "recovery",
      startsAt: now + 120000,
      endsAt: now + 300000,
      timeZone: "UTC",
    },
    now,
    id,
  );
  expect(await nextGraceDeadline(db, now)).toBe(now + 120000);
  await setSlotStatus(
    db,
    { slotId: s.id, status: "started", actor: "system" },
    now,
    id,
  );
  expect(await nextGraceDeadline(db, now)).toBe(now + 300000);
});

test("canonical Stripe state wins over old event snapshots and old subscriptions", async () => {
  const user = await seedUser();
  const current = {
    id: "sub-new",
    customer: "cus",
    created: 200,
    metadata: { userId: user.userId },
    status: "active",
    cancel_at_period_end: true,
    items: {
      data: [{ price: { id: "price" }, current_period_end: 1900000000 }],
    },
  } as unknown as Stripe.Subscription;
  const old = {
    ...current,
    id: "sub-old",
    created: 100,
    status: "canceled",
  } as Stripe.Subscription;
  const retrieve = vi.fn(async (id: string) =>
    id === "sub-old" ? old : current,
  );
  const stripe = { subscriptions: { retrieve } } as unknown as Pick<
    Stripe,
    "subscriptions"
  >;
  const event = (id: string, sub: Stripe.Subscription) =>
    ({
      id,
      type: "customer.subscription.updated",
      data: { object: { ...sub, status: "past_due" } },
    }) as Stripe.Event;
  await applyBillingEvent(
    directory(),
    stripe,
    event("evt-new", current),
    Date.now(),
  );
  await applyBillingEvent(
    directory(),
    stripe,
    event("evt-old", old),
    Date.now(),
  );
  expect(
    await directory().subscription.findUnique({
      where: { userId: user.userId },
    }),
  ).toMatchObject({
    stripeSubscriptionId: "sub-new",
    status: "active",
    cancelAtPeriodEnd: true,
  });
  const calls = retrieve.mock.calls.length;
  expect(
    await applyBillingEvent(
      directory(),
      stripe,
      event("evt-old", old),
      Date.now(),
    ),
  ).toBe(false);
  expect(retrieve).toHaveBeenCalledTimes(calls);
});

test("a failed Stripe reconciliation is not consumed and can be retried", async () => {
  const user = await seedUser();
  const current = {
    id: "sub",
    customer: "cus",
    created: 1,
    metadata: { userId: user.userId },
    status: "active",
    cancel_at_period_end: false,
    items: { data: [] },
  } as unknown as Stripe.Subscription;
  const retrieve = vi
    .fn()
    .mockRejectedValueOnce(new Error("Stripe unavailable"))
    .mockResolvedValue(current);
  const stripe = { subscriptions: { retrieve } } as unknown as Pick<
    Stripe,
    "subscriptions"
  >;
  const event = {
    id: "evt-retry",
    type: "customer.subscription.updated",
    data: { object: current },
  } as Stripe.Event;
  await expect(
    applyBillingEvent(directory(), stripe, event, Date.now()),
  ).rejects.toThrow("Stripe unavailable");
  expect(await directory().processedEvent.count()).toBe(0);
  expect(await applyBillingEvent(directory(), stripe, event, Date.now())).toBe(
    true,
  );
});

const config = {
  TURSO_DIRECTORY_URL: "http://127.0.0.1:41090",
  TURSO_USER_HOST: "http://127.0.0.1:41091",
} as ServerEnv;
test("grace recovery finds distinct free gaps after meetings, not now + five", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const db = userDb();
  const now = tomorrowNoon();
  const { calendarId } = await seedCalendar();
  await db.calendar.update({
    where: { id: calendarId },
    data: { isSelected: true },
  });
  await upsertEvents(
    db,
    { calendarId, storeTitles: true },
    [
      {
        providerEventId: "busy",
        title: "Meeting",
        startsAt: now + 300000,
        endsAt: now + 1800000,
        isAllDay: false,
        kind: "default",
        busyStatus: "busy",
        responseStatus: "accepted",
        isCancelled: false,
        changeTag: "1",
        joinUrl: null,
        description: null,
      },
    ],
    now,
    id,
  );
  for (let i = 0; i < 2; i++) {
    const s = await placeSlot(
      db,
      {
        activityId: null,
        title: "Recovery",
        kind: "recovery",
        startsAt: now - 900000 + i,
        endsAt: now - 300000 + i,
        timeZone: "UTC",
      },
      now,
      id,
    );
    await db.slot.update({ where: { id: s.id }, data: { isLocked: false } });
  }
  await sweepGrace(
    { ...user, type: "grace-sweep", workId: "" } as SyncJob,
    config,
    now,
  );
  const slots = await db.slot.findMany({ orderBy: { startsAt: "asc" } });
  expect(slots[0]?.startsAt.getTime()).toBe(now + 1800000);
  expect(slots[1]?.startsAt.getTime()).toBe(slots[0]?.endsAt.getTime());
});

test("grace recovery buckets work when the working day cannot fit it", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const db = userDb();
  const now = tomorrowNoon();
  await directory().user.update({
    where: { id: user.userId },
    data: { dayEndMinutes: 725 },
  });
  const s = await placeSlot(
    db,
    {
      activityId: null,
      title: "Recovery",
      kind: "recovery",
      startsAt: now - 900000,
      endsAt: now - 300000,
      timeZone: "UTC",
    },
    now,
    id,
  );
  await db.slot.update({ where: { id: s.id }, data: { isLocked: false } });
  await sweepGrace(
    { ...user, type: "grace-sweep", workId: "" } as SyncJob,
    config,
    now,
  );
  expect(await db.slot.findUnique({ where: { id: s.id } })).toMatchObject({
    status: "bucketed",
  });
  expect(
    await db.slotEvent.findFirst({
      where: { slotId: s.id, reasonCode: "no_gap" },
    }),
  ).not.toBeNull();
});

test("schema catch-up fails closed and succeeds on a later retry", async () => {
  const user = await seedUser({ schemaVersion: 0 });
  const db = directory();
  await db.$executeRawUnsafe(
    "CREATE TRIGGER refuse_schema BEFORE UPDATE OF schema_version ON users BEGIN SELECT RAISE(ABORT, 'schema failed'); END",
  );
  try {
    expect(
      (
        await worker.default.fetch("http://api/todos", {
          headers: user.headers,
        })
      ).status,
    ).toBe(503);
    expect(
      await db.user.findUnique({ where: { id: user.userId } }),
    ).toMatchObject({ schemaVersion: 0 });
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER refuse_schema");
  }
  expect(
    (await worker.default.fetch("http://api/todos", { headers: user.headers }))
      .status,
  ).toBe(200);
});

test("a late sweep cannot overwrite a new write-ahead wake-up", async () => {
  const user = await seedUser();
  const db = directory();
  const now = Date.now();
  const input = {
    userId: user.userId,
    kind: "grace_sweep" as const,
    dueAt: now,
  };
  await scheduleWork(db, input, now, id);
  const [old] = await dueWork(db, now, 1);
  if (!old) throw new Error("missing work");
  await scheduleWork(db, { ...input, dueAt: now + 60000 }, now, id);
  await completeWork(db, old.id, now + 900000, old.revision);
  await failWork(db, old.id, now, old.revision);
  const latest = await db.scheduledWork.findUnique({ where: { id: old.id } });
  expect(latest).toMatchObject({
    dueAt: new Date(now + 60000),
    failures: 0,
    revision: old.revision + 1,
  });
  await completeWork(db, old.id, now + 120000, old.revision + 1);
  expect(
    await db.scheduledWork.findUnique({ where: { id: old.id } }),
  ).toMatchObject({ dueAt: new Date(now + 120000) });
});

test("a failed privacy preference write leaves the local fence closed", async () => {
  const user = await seedUser();
  const db = directory();
  await db.$executeRawUnsafe(
    "CREATE TRIGGER refuse_privacy BEFORE UPDATE OF store_event_titles ON users BEGIN SELECT RAISE(ABORT, 'preference failed'); END",
  );
  try {
    const response = await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: user.headers,
      body: JSON.stringify({ storeEventTitles: false }),
    });
    expect(response.status).toBe(500);
    expect(
      await userDb().$queryRawUnsafe("SELECT store_titles FROM _event_privacy"),
    ).toEqual([{ store_titles: 0 }]);
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER refuse_privacy");
  }
  expect(
    (
      await worker.default.fetch("http://api/settings", {
        method: "PATCH",
        headers: user.headers,
        body: JSON.stringify({ storeEventTitles: false }),
      })
    ).status,
  ).toBe(204);
});

test("concurrent deliveries of the same action commit once", async () => {
  const s = await slot();
  await Promise.all(
    [1, 2].map(() =>
      setSlotStatus(
        userDb(),
        {
          slotId: s.id,
          status: "started",
          actor: "user",
          actionId: "concurrent",
        },
        Date.now(),
        id,
      ),
    ),
  );
  expect(
    await userDb().slotEvent.count({
      where: { slotId: s.id, type: "started" },
    }),
  ).toBe(1);
});
