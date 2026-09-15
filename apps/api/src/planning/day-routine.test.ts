import { exports as worker } from "cloudflare:workers";
import { listActivities, scheduleActivityChanges, updateActivity, placeSlot, setSlotStatus } from "@wiseroutine/db";
import { dayBounds, localDateOf } from "@wiseroutine/scheduler";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetDatabases, seedUser, seedActivity, testFeatures, type TestUser, userDb } from "../test-support";
import { localDateKey, planDay } from "./planDay";

const M = 60_000;
const id = () => crypto.randomUUID();
const now = Date.now();
const todayDate = localDateOf(now, "UTC");
const today = localDateKey(todayDate);
const midnight = dayBounds(todayDate, "UTC", 0, 1440).start;
const tomorrow = localDateKey(localDateOf(midnight + 86400000, "UTC"));
const nextDay = midnight + 86400000;
const settings = { timeZone: "UTC", dayStartMinutes: 480, dayEndMinutes: 1080 };
const request = (user: TestUser, path: string, body?: unknown, method = "POST") => worker.default.fetch(`http://api${path}`, {
  method: body === undefined ? "GET" : method,
  headers: { ...user.headers, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const readDay = async (user: TestUser, at = now) => {
  const response = await request(user, `/today?at=${at}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ date: typeof todayDate; slots: { id: string }[]; progress: { id: string; minimumValue: number; sessionMinutes: number; scheduled: number; count: number }[] }>;
};

beforeEach(async () => {
  await resetDatabases();
  await testFeatures({ day_view_options: true });
});
afterEach(() => vi.restoreAllMocks());

test("new activities start tomorrow; repeated edits replace tomorrow's choice without creating slots", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const created = await request(user, "/activities", { name: "Walk", minimumValue: 4, sessionMinutes: 20 });
  expect(created.status).toBe(201);
  const { id: activityId } = await created.json() as { id: string };
  expect((await readDay(user)).progress).toEqual([]);
  expect((await readDay(user, nextDay + 9 * 60 * M)).progress).toMatchObject([{ minimumValue: 4, scheduled: 0 }]);
  for (const minimumValue of [2, 5, 4])
    expect((await request(user, `/activities/${activityId}`, { minimumValue }, "PATCH")).status).toBe(204);
  expect((await readDay(user)).progress).toEqual([]);
  expect((await readDay(user, nextDay + 9 * 60 * M)).progress).toMatchObject([{ minimumValue: 4, scheduled: 0 }]);
  expect(await userDb().activitySchedule.count()).toBe(2); // baseline + one tomorrow choice
  expect(await userDb().slot.count()).toBe(0);
  expect(await userDb().planRun.count()).toBe(0);
  expect(await (await request(user, "/activities")).json()).toMatchObject([{ changesFrom: tomorrow }]);
});

test("increases, reductions and duration edits leave today's completed, past and unplaced occurrences unchanged", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const activityId = await seedActivity({ name: "Stretch", minimumValue: 3, sessionMinutes: 10 });
  for (const [index, status] of ["completed", "missed", "bucketed"].entries()) {
    await userDb().slot.create({ data: { id: `today-${index}`, activityId, title: "Stretch", kind: "recovery", status, startsAt: new Date(midnight + (8 + index) * 60 * M), endsAt: new Date(midnight + (8 + index) * 60 * M + 10 * M), timeZone: "UTC", createdAt: new Date() } });
  }
  const rows = await userDb().slot.findMany({ orderBy: { id: "asc" } });
  for (const [minimumValue, sessionMinutes] of [[5, 10], [1, 60], [2, 30]]) {
    expect((await request(user, `/activities/${activityId}`, { minimumValue, sessionMinutes }, "PATCH")).status).toBe(204);
    expect((await readDay(user)).progress).toMatchObject([{ minimumValue: 3, sessionMinutes: 10, count: 1, scheduled: 2 }]);
    expect(await userDb().slot.findMany({ orderBy: { id: "asc" } })).toEqual(rows);
  }
  expect((await readDay(user, nextDay + 9 * 60 * M)).progress).toMatchObject([{ minimumValue: 2, sessionMinutes: 30, count: 0, scheduled: 0 }]);
  expect((await listActivities(userDb(), today))[0]?.row.minimumValue).toBe(3);
  expect((await listActivities(userDb(), tomorrow))[0]?.row.minimumValue).toBe(2);
});

test("daily shortfalls do not carry over, but saved one-off work survives", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const stretch = await seedActivity({ name: "Stretch", minimumValue: 3 });
  const walk = await seedActivity({ name: "Walk", minimumValue: 4, sessionMinutes: 20 });
  for (const [index, activityId] of [stretch, stretch, walk, walk, walk, walk].entries()) {
    await userDb().slot.create({ data: { id: `old-${index}`, activityId, title: "Old routine", kind: "recovery", status: "bucketed", startsAt: new Date(midnight - 12 * 60 * M), endsAt: new Date(midnight - 12 * 60 * M + 10 * M), timeZone: "UTC", createdAt: new Date() } });
  }
  const oneOff = await placeSlot(userDb(), { activityId: null, title: "Saved reading", kind: "task", startsAt: midnight - 12 * 60 * M, endsAt: midnight - 12 * 60 * M + 10 * M, timeZone: "UTC" }, now, id);
  await setSlotStatus(userDb(), { slotId: oneOff.id, status: "bucketed", actor: "user" }, now, id);
  expect(await (await request(user, "/bucket")).json()).toMatchObject([{ id: oneOff.id }]);
  const progress = (await readDay(user)).progress;
  expect(progress.find((a) => a.id === stretch)).toMatchObject({ minimumValue: 3, scheduled: 0, count: 0 });
  expect(progress.find((a) => a.id === walk)).toMatchObject({ minimumValue: 4, scheduled: 0, count: 0 });
  for (const action of ["move", "reschedule"])
    expect((await request(user, `/slots/old-0/${action}`, { startsAt: nextDay + 10 * 60 * M, endsAt: nextDay + 10 * 60 * M + 10 * M })).status).toBe(409);
  const result = await planDay(userDb(), { user: settings, onDay: nextDay, trigger: "user_request", preservePlanned: true, retryUnplaced: true }, nextDay, id);
  expect(result.created).toBe(8); // 3 stretches + 4 walks + saved one-off
  expect(await userDb().slot.count({ where: { id: { startsWith: "old-" }, status: "bucketed" } })).toBe(6);
  expect(await userDb().slot.findUnique({ where: { id: oneOff.id } })).toMatchObject({ status: "planned" });
});

test("the following day's edits never rewrite either earlier day", async () => {
  await seedUser({ timeZone: "UTC" });
  const activityId = await seedActivity({ minimumValue: 3 });
  let previous = (await listActivities(userDb()))[0]!;
  await updateActivity(userDb(), activityId, { minimumValue: 4 });
  await scheduleActivityChanges(userDb(), activityId, tomorrow, previous);
  previous = (await listActivities(userDb()))[0]!;
  const dayAfter = localDateKey(localDateOf(nextDay + 86400000, "UTC"));
  await updateActivity(userDb(), activityId, { minimumValue: 1 });
  await scheduleActivityChanges(userDb(), activityId, dayAfter, previous);
  for (const [date, count] of [[today, 3], [tomorrow, 4], [dayAfter, 1]] as const)
    expect((await listActivities(userDb(), date))[0]?.row.minimumValue).toBe(count);
});

test("a routine switches at local midnight without an edit or a planning write", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const created = await request(user, "/activities", { name: "Walk", minimumValue: 4, sessionMinutes: 20 });
  expect(created.status).toBe(201);
  vi.spyOn(Date, "now").mockReturnValue(nextDay);
  const response = await request(user, "/today");
  const day = await response.json() as { date: typeof todayDate; progress: { minimumValue: number; scheduled: number }[] };
  expect(day.date).toEqual(localDateOf(nextDay, "UTC"));
  expect(day.progress).toMatchObject([{ minimumValue: 4, scheduled: 0 }]);
  expect(await userDb().slot.count()).toBe(0);
});
