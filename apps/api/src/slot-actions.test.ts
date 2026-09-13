import { exports as worker } from "cloudflare:workers";
import { placeSlot, setSlotStatus } from "@wiseroutine/db";
import { beforeEach, expect, test } from "vitest";
import {
  resetDatabases,
  seedUser,
  type TestUser,
  testFeatures,
  tomorrowNoon,
  userDb,
} from "./test-support";

beforeEach(async () => {
  await resetDatabases();
  await testFeatures("all");
});
const id = () => crypto.randomUUID();
const post = (
  user: TestUser,
  slotId: string,
  action: string,
  body: unknown = {},
  key?: string,
) =>
  worker.default.fetch(`http://api/slots/${slotId}/${action}`, {
    method: "POST",
    headers: {
      ...user.headers,
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
async function setup(minutes = 10, startedAt = Date.now() - 600_000) {
  const user = await seedUser();
  const slot = await placeSlot(
    userDb(),
    {
      activityId: null,
      title: "Focus",
      kind: "focus",
      startsAt: tomorrowNoon(),
      endsAt: tomorrowNoon() + minutes * 60_000,
      timeZone: "UTC",
    },
    startedAt,
    id,
  );
  expect((await post(user, slot.id, "start", { at: startedAt })).status).toBe(
    204,
  );
  return { user, slot, startedAt };
}

test.each([1, 3, 4, 10])(
  "%i-minute slots accept early offline Stops and refuse the exact cutoff atomically",
  async (minutes) => {
    const { user, slot, startedAt } = await setup(minutes);
    const deadline = startedAt + Math.min(minutes * 30_000, 120_000);
    const key = id();
    const denied = await post(user, slot.id, "skip", { at: deadline }, key);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({
      message: expect.stringContaining("stop window has closed"),
    });
    expect(
      await userDb().slot.findUnique({ where: { id: slot.id } }),
    ).toMatchObject({ status: "started" });
    expect(
      await userDb().slotEvent.count({
        where: { slotId: slot.id, type: "skipped" },
      }),
    ).toBe(0);
    // A refusal must not consume the action id. Delivery time isn't action time.
    expect(
      (await post(user, slot.id, "skip", { at: deadline - 1 }, key)).status,
    ).toBe(204);
    expect(
      (await post(user, slot.id, "skip", { at: deadline - 1 }, key)).status,
    ).toBe(204);
    expect(
      await userDb().slotEvent.count({
        where: { slotId: slot.id, type: "skipped" },
      }),
    ).toBe(1);
  },
);

test("started slots cannot postpone, bucket, move or cancel, even inside the stop window", async () => {
  const { user, slot } = await setup(10, Date.now());
  const times = {
    startsAt: slot.startsAt + 3_600_000,
    endsAt: slot.endsAt + 3_600_000,
  };
  for (const [action, body] of [
    ["reschedule", times],
    ["reschedule", { bucket: true }],
    ["move", times],
    ["cancel", {}],
  ] as const)
    expect((await post(user, slot.id, action, body)).status).toBe(409);
  expect(await userDb().slot.count()).toBe(1);
  expect(
    await userDb().slot.findUnique({ where: { id: slot.id } }),
  ).toMatchObject({ status: "started", startsAt: new Date(slot.startsAt) });
  expect(await userDb().slotEvent.count({ where: { slotId: slot.id } })).toBe(
    2,
  );
});

test("another Start does not renew the window, and Today exposes the durable start across reads", async () => {
  const { user, slot, startedAt } = await setup();
  const responses = await Promise.all(
    [1, 2].map(() => post(user, slot.id, "start", {}, id())),
  );
  expect(responses.map((r) => r.status)).toEqual([204, 204]);
  expect(
    await userDb().slotEvent.count({
      where: { slotId: slot.id, type: "started" },
    }),
  ).toBe(1);
  expect((await post(user, slot.id, "skip")).status).toBe(409);
  for (let i = 0; i < 2; i++) {
    const response = await worker.default.fetch(
      `http://api/today?at=${slot.startsAt}&range=full`,
      { headers: user.headers },
    );
    expect(response.status).toBe(200);
    const day = (await response.json()) as {
      slots: { id: string; startedAt: number }[];
    };
    expect(day.slots.find((s) => s.id === slot.id)?.startedAt).toBe(startedAt);
  }
  expect((await post(user, slot.id, "complete")).status).toBe(204);
});

test("a real early stop and resume gets a new short window", async () => {
  const { user, slot, startedAt } = await setup(3);
  expect(
    (await post(user, slot.id, "skip", { at: startedAt + 1_000 })).status,
  ).toBe(204);
  const resumedAt = startedAt + 180_000;
  expect((await post(user, slot.id, "start", { at: resumedAt })).status).toBe(
    204,
  );
  expect(
    (await post(user, slot.id, "skip", { at: resumedAt + 90_000 })).status,
  ).toBe(409);
  expect(
    (await post(user, slot.id, "skip", { at: resumedAt + 89_999 })).status,
  ).toBe(204);
});

test("recovery can still record that an already ended block did not happen", async () => {
  const { user, slot } = await setup();
  const endsAt = Date.now() - 60_000;
  await userDb().slot.update({
    where: { id: slot.id },
    data: { startsAt: new Date(endsAt - 600_000), endsAt: new Date(endsAt) },
  });
  expect((await post(user, slot.id, "skip")).status).toBe(204);
});

test("addon Stop uses the same cutoff while background recovery remains possible", async () => {
  const { slot, startedAt } = await setup();
  await expect(
    setSlotStatus(
      userDb(),
      { slotId: slot.id, status: "skipped", actor: "addon" },
      startedAt + 120_000,
      id,
    ),
  ).rejects.toThrow("stop window has closed");
  await setSlotStatus(
    userDb(),
    { slotId: slot.id, status: "missed", actor: "system" },
    startedAt + 120_000,
    id,
  );
  expect(
    await userDb().slot.findUnique({ where: { id: slot.id } }),
  ).toMatchObject({ status: "missed" });
});
