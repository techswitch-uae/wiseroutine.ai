import { exports as worker } from "cloudflare:workers";
import { moveSlot, placeSlot, setSlotStatus } from "@wiseroutine/db";
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
async function setup(status: "planned" | "live" | "skipped", minutes = 30) {
  const user = await seedUser();
  const startsAt = Date.now() - 180_000;
  const slot = await placeSlot(
    userDb(),
    {
      activityId: null,
      title: "Reading",
      kind: "focus",
      startsAt,
      endsAt: startsAt + minutes * 60_000,
      timeZone: "UTC",
    },
    startsAt - 600_000,
    id,
  );
  if (status === "skipped") {
    await setSlotStatus(
      userDb(),
      { slotId: slot.id, status: "started", actor: "user" },
      startsAt - 300_000,
      id,
    );
    await setSlotStatus(
      userDb(),
      { slotId: slot.id, status: "skipped", actor: "user" },
      startsAt - 299_000,
      id,
    );
  } else if (status === "live") {
    await userDb().slot.update({ where: { id: slot.id }, data: { status } });
  }
  return { user, slot, deadline: Math.min(startsAt + 120_000, slot.endsAt) };
}

test.each(["planned", "live", "skipped"] as const)(
  "%s cannot move, postpone or bucket after the cutoff, but can record Done",
  async (status) => {
    const { user, slot, deadline } = await setup(status);
    const events = await userDb().slotEvent.count();
    const destination = {
      startsAt: tomorrowNoon(),
      endsAt: tomorrowNoon() + 30 * 60_000,
    };
    if (status === "skipped") {
      expect((await post(user, slot.id, "start", { at: deadline })).status).toBe(409);
      expect((await post(user, slot.id, "start")).status).toBe(409);
    }
    for (const [action, body] of [
      ["move", destination],
      ["reschedule", destination],
      ["reschedule", { bucket: true }],
    ] as const) {
      expect((await post(user, slot.id, action, body, id())).status).toBe(409);
    }
    expect(await userDb().slot.count()).toBe(1);
    expect(await userDb().slotEvent.count()).toBe(events);
    expect(
      await userDb().slot.findUnique({ where: { id: slot.id } }),
    ).toMatchObject({ status, startsAt: new Date(slot.startsAt) });
    expect((await post(user, slot.id, "complete")).status).toBe(204);
    expect(
      await userDb().slot.findUnique({ where: { id: slot.id } }),
    ).toMatchObject({ status: "completed" });
  },
);

test.each(["planned", "live"] as const)("%s accepts first Start after the movement cutoff without moving or extending the slot", async (status) => {
  const { user, slot, deadline } = await setup(status);
  const key = id();
  expect((await post(user, slot.id, "start", { at: deadline }, key)).status).toBe(204);
  expect((await post(user, slot.id, "start", { at: deadline }, key)).status).toBe(204);
  expect(await userDb().slot.findUnique({ where: { id: slot.id } })).toMatchObject({
    status: "started", startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt),
  });
  expect(await userDb().slotEvent.count({ where: { slotId: slot.id, type: "started" } })).toBe(1);
});

test.each([1, 2, 10])("a %i-minute slot accepts Start strictly before its end, never at it", async (minutes) => {
  const { slot } = await setup("planned", minutes);
  const action = { slotId: slot.id, status: "started" as const, actor: "user" as const };
  await expect(setSlotStatus(userDb(), action, slot.endsAt, id)).rejects.toThrow("can no longer be started");
  await setSlotStatus(userDb(), action, slot.endsAt - 1, id);
  expect(await userDb().slot.findUnique({ where: { id: slot.id } })).toMatchObject({ status: "started" });
});

test.each(["user", "system"] as const)("%s cannot move an unstarted slot at the movement cutoff", async (actor) => {
  const { slot, deadline } = await setup("planned");
  await expect(moveSlot(userDb(), { slotId: slot.id, startsAt: tomorrowNoon(), endsAt: tomorrowNoon() + 600_000, actor }, deadline, id)).rejects.toThrow("can no longer be moved");
});

test.each([1, 10])(
  "a %i-minute slot accepts an offline Resume before the cutoff, never at it",
  async (minutes) => {
    const { user, slot, deadline } = await setup("skipped", minutes);
    const key = id();
    expect(
      (await post(user, slot.id, "start", { at: deadline }, key)).status,
    ).toBe(409);
    // A rejected action must not consume its identity. Delivery time is not action time.
    expect(
      (await post(user, slot.id, "start", { at: deadline - 1 }, key)).status,
    ).toBe(204);
    expect(
      (await post(user, slot.id, "start", { at: deadline - 1 }, key)).status,
    ).toBe(204);
    expect(
      await userDb().slotEvent.count({
        where: { slotId: slot.id, type: "started" },
      }),
    ).toBe(2);
    expect(await userDb().slot.count()).toBe(1);
  },
);

test("moving a stopped slot enforces the exact cutoff in the transaction and preserves its identity before it", async () => {
  const { slot, deadline } = await setup("skipped");
  const move = {
    slotId: slot.id,
    startsAt: tomorrowNoon(),
    endsAt: tomorrowNoon() + 30 * 60_000,
    actor: "user" as const,
  };
  await expect(moveSlot(userDb(), move, deadline, id)).rejects.toThrow(
    "can no longer be moved",
  );
  await moveSlot(userDb(), move, deadline - 1, id);
  expect(await userDb().slot.count()).toBe(1);
  expect(
    await userDb().slot.findUnique({ where: { id: slot.id } }),
  ).toMatchObject({
    status: "planned",
    startsAt: new Date(move.startsAt),
    isLocked: true,
  });
  expect(
    await userDb().slotEvent.count({
      where: { slotId: slot.id, type: "skipped" },
    }),
  ).toBe(1);
  expect(
    await userDb().slotEvent.count({
      where: { slotId: slot.id, type: "user_moved" },
    }),
  ).toBe(1);
});
