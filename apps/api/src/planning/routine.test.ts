import { exports as worker } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import {
  directory,
  resetDatabases,
  seedActivity,
  seedCalendar,
  seedUser,
  type TestUser,
  testFeatures,
  userDb,
} from "../test-support";
import { planDay } from "./planDay";

const M = 60_000;
const date = new Date(Date.now() + 86400000);
date.setUTCHours(9, 0, 0, 0);
const start = date.getTime();
const userSettings = {
  timeZone: "UTC",
  dayStartMinutes: 540,
  dayEndMinutes: 1020,
};
const solve = (from = start) =>
  planDay(
    userDb(),
    { user: userSettings, onDay: start, from, trigger: "user_request" },
    Date.now(),
    () => crypto.randomUUID(),
  );
const request = (
  user: TestUser,
  path: string,
  body?: unknown,
  method = "POST",
) =>
  worker.default.fetch(`http://api${path}`, {
    method: body === undefined ? "GET" : method,
    headers: { ...user.headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(async () => {
  await resetDatabases();
  await testFeatures("all");
});

test("an unplanned morning waits for manual placement or Place them for me", async () => {
  const offset = ((9 - new Date().getUTCHours() + 36) % 24) - 12;
  const timeZone = `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
  const user = await seedUser({ timeZone });
  const activityId = await seedActivity({ minimumValue: 3 });
  const morning = (await (await request(user, "/today")).json()) as {
    slots: unknown[];
    progress: { scheduled: number; minimumValue: number }[];
  };
  expect(morning.slots).toEqual([]);
  expect(morning.progress[0]).toMatchObject({ minimumValue: 3, scheduled: 0 });
  expect(await userDb().planRun.count()).toBe(0);
  const startsAt = Math.ceil(Date.now() / (5 * M)) * 5 * M + 10 * M;
  expect((await request(user, "/slots", { activityId, startsAt })).status).toBe(
    201,
  );
  expect(await (await request(user, "/plan", {})).json()).toMatchObject({
    placed: 2,
    removed: 0,
  });
  expect(await userDb().slot.count({ where: { status: "planned" } })).toBe(3);
  await request(user, "/today");
  expect(await userDb().slot.count()).toBe(3);
});

test("reading future days with weekly planning enabled never creates appointments or plan runs", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  await seedActivity({ minimumValue: 3 });
  for (const at of [start, start + 86_400_000, start, start + 2 * 86_400_000]) {
    const response = await request(user, `/today?at=${at}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slots: [], progress: [{ minimumValue: 3, scheduled: 0 }] });
  }
  expect(await userDb().slot.count()).toBe(0);
  expect(await userDb().slotEvent.count()).toBe(0);
  expect(await userDb().planRun.count()).toBe(0);
});

test("all explicit placement trigger names preserve accepted unpinned slots and their history", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  await seedActivity({ minimumValue: 3 });
  expect(await (await request(user, "/plan", { at: start })).json()).toMatchObject({ placed: 3, removed: 0 });
  const slots = await userDb().slot.findMany({ orderBy: { id: "asc" } });
  expect(slots.every((slot) => !slot.isLocked)).toBe(true);
  const events = await userDb().slotEvent.count();
  for (const trigger of ["morning", "calendar_change", "missed_replan", "user_request"]) {
    expect(await (await request(user, "/plan", { at: start, trigger })).json()).toMatchObject({ placed: 0, removed: 0, unplaced: [] });
    expect(await userDb().slot.findMany({ orderBy: { id: "asc" } })).toEqual(slots);
    expect(await userDb().slotEvent.count()).toBe(events);
  }
  expect((await request(user, "/plan", { trigger: "replace_everything" })).status).toBe(400);
});

test("initial shortfalls persist once, do not double-count demand, and can be manually placed", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const id = await seedActivity({ name: "Stretch", minimumValue: 3 });
  const { calendarId } = await seedCalendar();
  const db = userDb();
  await db.externalEvent.create({
    data: {
      id: "busy",
      calendarId,
      providerEventId: "busy",
      title: "Workshop",
      startsAt: new Date(start),
      endsAt: new Date(start + 8 * 60 * M),
      updatedAt: new Date(),
    },
  });
  expect((await solve()).unplaced).toEqual([
    { activityId: id, sessions: 3, reason: "no_gap" },
  ]);
  const bucket = (await (
    await request(user, `/bucket?at=${start}`)
  ).json()) as {
    id: string;
    initiallyUnplaced: boolean;
    reasonCode: string;
    startsAt: number;
    endsAt: number;
  }[];
  expect(bucket).toHaveLength(3);
  expect(
    bucket.every(
      (s) =>
        s.initiallyUnplaced &&
        s.reasonCode === "no_gap" &&
        s.endsAt - s.startsAt === 10 * M,
    ),
  ).toBe(true);
  const today = (await (await request(user, `/today?at=${start}`)).json()) as {
    slots: unknown[];
    progress: { scheduled: number }[];
  };
  expect(today.slots).toEqual([]);
  expect(today.progress[0]?.scheduled).toBe(3);
  expect((await solve()).unplaced).toEqual([]);
  expect(await db.slot.count()).toBe(3);
  await db.externalEvent.deleteMany();
  // Freeing time must not silently pull bucket choices back onto Today.
  expect((await solve()).placed).toEqual([]);
  const chosen = bucket[0]!.id;
  expect(
    (
      await request(user, `/slots/${chosen}/move`, {
        startsAt: start + 120 * M,
        endsAt: start + 130 * M,
      })
    ).status,
  ).toBe(204);
  expect(await db.slot.findUnique({ where: { id: chosen } })).toMatchObject({
    status: "planned",
    isLocked: true,
  });
  await solve();
  expect(await db.slot.count()).toBe(3);
  expect(await db.slot.count({ where: { status: "bucketed" } })).toBe(2);
  expect(
    (await request(user, `/slots/${bucket[1]!.id}/cancel`, {})).status,
  ).toBe(204);
  await solve();
  expect(await db.slot.count()).toBe(3);
  expect(await db.slot.count({ where: { status: "bucketed" } })).toBe(1);
  const afterDrop = (await (
    await request(user, `/today?at=${start}`)
  ).json()) as { progress: { scheduled: number }[] };
  expect(afterDrop.progress[0]?.scheduled).toBe(3);
});

test("Place them for me restores saved slots once and leaves accepted placements alone", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  await seedActivity({ minimumValue: 3 });
  await solve(start + 9 * 60 * M); // no room: three saved occurrences
  const db = userDb();
  const before = await db.slot.findMany({ orderBy: { id: "asc" } });
  const response = await request(user, "/plan", { at: start });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    placed: 3,
    removed: 0,
    unplaced: [],
  });
  const placed = await db.slot.findMany({ orderBy: { id: "asc" } });
  expect(placed.map((slot) => slot.id)).toEqual(before.map((slot) => slot.id));
  expect(placed.every((slot) => slot.status === "planned")).toBe(true);
  expect(
    await (await request(user, "/plan", { at: start })).json(),
  ).toMatchObject({ placed: 0, removed: 0, unplaced: [] });
  expect(await db.slot.findMany({ orderBy: { id: "asc" } })).toEqual(placed);
});

test("retrying preserves different saved durations and can fit a shorter slot after a longer one fails", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  await directory().user.update({
    where: { id: user.userId },
    data: { dayStartMinutes: 540, dayEndMinutes: 1020 },
  });
  const id = await seedActivity({ minimumValue: 2, sessionMinutes: 10 });
  const db = userDb();
  for (const [slotId, minutes] of [
    ["long", 30],
    ["short", 10],
  ] as const)
    await db.slot.create({
      data: {
        id: slotId,
        activityId: id,
        title: "Stretch",
        kind: "recovery",
        status: "bucketed",
        startsAt: new Date(start),
        endsAt: new Date(start + minutes * M),
        timeZone: "UTC",
        createdAt: new Date(),
      },
    });
  const { calendarId } = await seedCalendar();
  await db.externalEvent.create({
    data: {
      id: "busy",
      calendarId,
      providerEventId: "busy",
      startsAt: new Date(start + 20 * M),
      endsAt: new Date(start + 8 * 60 * M),
      updatedAt: new Date(),
    },
  });
  const run = await (await request(user, "/plan", { at: start })).json();
  expect(run).toMatchObject({ placed: 1, unplaced: [{ sessions: 1 }] });
  expect(await db.slot.findUnique({ where: { id: "long" } })).toMatchObject({
    status: "bucketed",
    startsAt: new Date(start),
    endsAt: new Date(start + 30 * M),
  });
  const short = await db.slot.findUnique({ where: { id: "short" } });
  expect(short?.status).toBe("planned");
  expect(Number(short?.endsAt) - Number(short?.startsAt)).toBe(10 * M);
  await request(user, "/plan", { at: start });
  expect(await db.slot.count()).toBe(2);
  expect(await db.slot.count({ where: { status: "bucketed" } })).toBe(1);
});

test("a paused activity's saved slots are reported as unavailable, not revived", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const activityId = await seedActivity({ isActive: false });
  await userDb().slot.create({
    data: {
      id: "paused",
      activityId,
      title: "Stretch",
      kind: "recovery",
      status: "bucketed",
      startsAt: new Date(start),
      endsAt: new Date(start + 10 * M),
      timeZone: "UTC",
      createdAt: new Date(),
    },
  });
  expect(
    await (await request(user, "/plan", { at: start })).json(),
  ).toMatchObject({
    placed: 0,
    unplaced: [{ activityId, sessions: 1, reason: "not_scheduled_today" }],
  });
  expect(
    await userDb().slot.findUnique({ where: { id: "paused" } }),
  ).toMatchObject({ status: "bucketed" });
  expect(await userDb().slot.count()).toBe(1);
});

test("an unplaced one-off slot can also be placed automatically without a new identity", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  await userDb().slot.create({
    data: {
      id: "one-off",
      activityId: null,
      title: "Read notes",
      kind: "task",
      status: "bucketed",
      startsAt: new Date(start),
      endsAt: new Date(start + 15 * M),
      timeZone: "UTC",
      createdAt: new Date(),
    },
  });
  expect(
    await (await request(user, "/plan", { at: start })).json(),
  ).toMatchObject({ placed: 1, unplaced: [] });
  expect(
    await userDb().slot.findUnique({ where: { id: "one-off" } }),
  ).toMatchObject({ status: "planned", title: "Read notes", activityId: null });
  expect(await userDb().slot.count()).toBe(1);
});

test("late and after-hours planning accounts for every occurrence without placing anything in the past", async () => {
  await seedUser({ timeZone: "UTC" });
  await seedActivity({ minimumValue: 3 });
  const late = start + 5 * 60 * M;
  const result = await solve(late);
  expect(result.placed.every((s) => s.start >= late)).toBe(true);
  expect(
    result.placed.length +
      result.unplaced.reduce((sum, s) => sum + s.sessions, 0),
  ).toBe(3);
  expect(await userDb().slot.count()).toBe(3);
  await userDb().slotEvent.deleteMany();
  await userDb().slot.deleteMany();
  expect((await solve(start + 9 * 60 * M)).placed).toEqual([]);
  expect(await userDb().slot.count({ where: { status: "bucketed" } })).toBe(3);
});

test("archiving clears old bucket entries as well as future ones", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const id = await seedActivity({ minimumValue: 3 });
  await solve(start + 9 * 60 * M);
  await userDb().slot.updateMany({
    data: {
      startsAt: new Date(Date.now() - 60 * M),
      endsAt: new Date(Date.now() - 50 * M),
    },
  });
  expect((await request(user, `/activities/${id}`, {}, "DELETE")).status).toBe(
    200,
  );
  expect(await userDb().slot.count({ where: { status: "bucketed" } })).toBe(0);
  expect(await userDb().slot.count({ where: { status: "cancelled" } })).toBe(3);
});

test("the API checks daily frequency against the merged duration on create and patch", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  expect(
    (
      await request(user, "/activities", {
        name: "Deep work",
        sessionMinutes: 25,
        minimumValue: 5,
      })
    ).status,
  ).toBe(400);
  const response = await request(user, "/activities", {
    name: "Deep work",
    sessionMinutes: 25,
    minimumValue: 4,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const invalid = await request(
    user,
    `/activities/${id}`,
    { sessionMinutes: 60 },
    "PATCH",
  );
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).toContain("up to 2");
  expect(await userDb().activity.findUnique({ where: { id } })).toMatchObject({
    sessionMinutes: 25,
    minimumValue: 4,
  });
  expect(
    (
      await request(
        user,
        `/activities/${id}`,
        { sessionMinutes: 60, minimumValue: 2 },
        "PATCH",
      )
    ).status,
  ).toBe(204);
  expect(await userDb().activity.findUnique({ where: { id } })).toMatchObject({
    sessionMinutes: 60,
    minimumValue: 2,
  });
});

test("manual moves reject even a slightly past time and never move started or done history", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  await seedActivity({ minimumValue: 1 });
  await solve();
  const slot = (await userDb().slot.findMany())[0]!;
  const past = Date.now() - 1000;
  expect(
    (
      await request(user, `/slots/${slot.id}/move`, {
        startsAt: past,
        endsAt: past + 10 * M,
      })
    ).status,
  ).toBe(400);
  for (const status of ["started", "completed"]) {
    await userDb().slot.update({ where: { id: slot.id }, data: { status } });
    expect(
      (
        await request(user, `/slots/${slot.id}/move`, {
          startsAt: start + 60 * M,
          endsAt: start + 70 * M,
        })
      ).status,
    ).toBe(409);
    expect(
      (await userDb().slot.findUnique({ where: { id: slot.id } }))?.startsAt,
    ).toEqual(slot.startsAt);
  }
});
