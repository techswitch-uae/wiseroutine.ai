import { exports as worker } from "cloudflare:workers";
import type { PlanId } from "@wiseroutine/plans";
import { beforeEach, describe, expect, test } from "vitest";
import { newId } from "../context";
import {
  directory,
  resetDatabases,
  seedActivity,
  seedCalendar,
  seedUser,
  type TestUser,
  userDb,
} from "../test-support";
import { realignAfterSync } from "./realign";

/**
 * A meeting moves, and the whole chain answers.
 *
 * The engine's rules are tested against sixty days of them in
 * `packages/scheduler`, and the translation into writes in
 * `planning/repair.test.ts`. Neither of those touches a database, so until
 * this file nothing checked the part in between: that the row really moved,
 * that a session with nowhere to go really lands in the bucket, that the day
 * stops drawing it, and that accepting the position the bucket offers puts it
 * back. Every one of those is a place a correct decision can still be lost.
 *
 * The corpus itself cannot run through here yet - 27 of its 60 scenarios use a
 * window, a `spread`, a configured breather or the literal busy reading, and
 * the schema can express none of those. See docs/rearrangement.md.
 */

beforeEach(resetDatabases);

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * Midnight UTC tomorrow.
 *
 * A day that has not started, so nothing here races the clock, and UTC so an
 * hour of the day is an hour of arithmetic rather than a zone lookup. The only
 * thing the real clock decides is which date this is.
 */
function tomorrow(): number {
  const at = new Date(Date.now() + 86_400_000);
  at.setUTCHours(0, 0, 0, 0);
  return at.getTime();
}

const DAY = tomorrow();
/** An hour of that day, as an instant. `hour(9.5)` is 09:30. */
const hour = (h: number): number => DAY + h * HOUR;

/**
 * 08:00-18:00, which is the directory's default working day.
 *
 * Spelled out rather than read back from the user row: every instant below is
 * written against these two hours, so a test that quietly followed a changed
 * default would keep passing while testing a day nobody described.
 */
const deps = (user: TestUser, plan: PlanId = "pro") => ({
  db: userDb(),
  directory: directory(),
  userId: user.userId,
  plan,
  user: { timeZone: "UTC", dayStartMinutes: 8 * 60, dayEndMinutes: 18 * 60 },
});

const seedSlot = async (
  activityId: string,
  start: number,
  minutes: number,
): Promise<string> => {
  const id = crypto.randomUUID();
  await userDb().slot.create({
    data: {
      id,
      activityId,
      title: "Deep work",
      kind: "focus",
      startsAt: new Date(start),
      endsAt: new Date(start + minutes * MINUTE),
      timeZone: "UTC",
      status: "planned",
      createdAt: new Date(),
    },
  });
  return id;
};

const seedMeeting = async (
  calendarId: string,
  start: number,
  end: number,
): Promise<string> => {
  const id = crypto.randomUUID();
  await userDb().externalEvent.create({
    data: {
      id,
      calendarId,
      providerEventId: `evt-${start}`,
      title: "Standup",
      startsAt: new Date(start),
      endsAt: new Date(end),
      updatedAt: new Date(),
    },
  });
  return id;
};

/** A pro user with one focus activity and one calendar. */
async function aDay(plan: PlanId = "pro") {
  const user = await seedUser({ plan, timeZone: "UTC" });
  const { calendarId } = await seedCalendar();
  const activityId = await seedActivity({
    name: "Deep work",
    kind: "focus",
    sessionMinutes: 30,
  });
  return { user, calendarId, activityId };
}

const slotRow = (id: string) =>
  userDb().slot.findUniqueOrThrow({ where: { id } });

const get = async <T>(user: TestUser, path: string): Promise<T> =>
  (await (
    await worker.default.fetch(`http://api${path}`, { headers: user.headers })
  ).json()) as T;

interface BucketEntry {
  id: string;
  title: string;
  wasAt: number;
  reasonCode: string | null;
  suggested: { startsAt: number; endsAt: number } | null;
}

describe("a meeting lands on a slot", () => {
  test("the row actually moves, and stops reporting the clash", async () => {
    const { user, calendarId, activityId } = await aDay();
    const slotId = await seedSlot(activityId, hour(10), 30);
    await seedMeeting(calendarId, hour(10), hour(11));

    const outcome = await realignAfterSync(deps(user), hour(9), newId);
    expect(outcome).toEqual({ conflicts: 1, moved: 1, bucketed: 0 });

    const slot = await slotRow(slotId);
    expect(slot.status).toBe("planned");
    // Somewhere that is not under the meeting, and still half an hour long:
    // `rearrange` never shortens a session to make it fit.
    expect(slot.endsAt.getTime() - slot.startsAt.getTime()).toBe(30 * MINUTE);
    expect(
      slot.startsAt.getTime() < hour(11) && slot.endsAt.getTime() > hour(10),
    ).toBe(false);
    // The marker was written by `markConflicts` moments earlier and is a cache
    // of an overlap this move just ended. A slot that escaped still wearing a
    // clash badge is the timeline lying in the other direction.
    expect(slot.conflictEventId).toBeNull();
    // Counted, because the thrash cap is what stops a slot walking down the
    // day one meeting at a time.
    expect(slot.autoMoveCount).toBe(1);

    expect(await get<BucketEntry[]>(user, `/bucket?at=${hour(12)}`)).toEqual(
      [],
    );
  });

  /**
   * The five-minute edge tolerance used to live here, and it was wrong.
   *
   * A meeting that runs one minute into a session has taken a minute of it,
   * and the version that ignored that let a meeting eat the top of a block
   * while the app reported a clean day. The answer to a small overlap is a
   * small move, not silence.
   */
  test("a one-minute overlap is repaired, not waved through", async () => {
    const { user, calendarId, activityId } = await aDay();
    const slotId = await seedSlot(activityId, hour(10), 30);
    await seedMeeting(calendarId, hour(10.5) - MINUTE, hour(11));

    const outcome = await realignAfterSync(deps(user), hour(9), newId);
    expect(outcome.moved).toBe(1);

    const slot = await slotRow(slotId);
    expect(slot.startsAt.getTime()).toBeLessThan(hour(10));
  });
});

describe("the bucket", () => {
  test("a day with no room hands the session back, and stops drawing it", async () => {
    const { user, calendarId, activityId } = await aDay();
    const slotId = await seedSlot(activityId, hour(10), 30);
    await seedMeeting(calendarId, hour(8), hour(18));

    const outcome = await realignAfterSync(deps(user), hour(9), newId);
    expect(outcome).toEqual({ conflicts: 1, moved: 0, bucketed: 1 });

    const slot = await slotRow(slotId);
    expect(slot.status).toBe("bucketed");
    // Filed at the hour it was due. Nothing invents a new time for a session
    // we just said we had nowhere to put.
    expect(slot.startsAt.getTime()).toBe(hour(10));

    const bucket = await get<BucketEntry[]>(user, `/bucket?at=${hour(12)}`);
    expect(bucket).toHaveLength(1);
    expect(bucket[0]?.id).toBe(slotId);
    expect(bucket[0]?.wasAt).toBe(hour(10));
    expect(bucket[0]?.reasonCode).toBe("no_gap");
    // No position, so no offer: a suggestion invented here would be the app
    // guessing where a session goes and calling it advice.
    expect(bucket[0]?.suggested).toBeNull();

    // It holds no time, so it is in the rail and not on the ruler. Drawing it
    // at 10:00 would put it straight back under the meeting.
    const today = await get<{ slots: { id: string }[] }>(
      user,
      `/today?at=${hour(12)}`,
    );
    expect(today.slots.map((s) => s.id)).not.toContain(slotId);
  });

  /**
   * The round trip the whole design turns on.
   *
   * A position far enough from home to be a different plan is a question, so
   * it is offered rather than applied - and the offer has to survive the trip
   * through the database and back out of `GET /bucket` intact, or accepting it
   * means choosing a time from scratch.
   */
  test("a position we would not apply is offered, and accepting it lands", async () => {
    const { user, calendarId, activityId } = await aDay();
    const slotId = await seedSlot(activityId, hour(10), 30);
    await seedMeeting(calendarId, hour(9), hour(15));

    expect(await realignAfterSync(deps(user), hour(9), newId)).toEqual({
      conflicts: 1,
      moved: 0,
      bucketed: 1,
    });

    const bucket = await get<BucketEntry[]>(user, `/bucket?at=${hour(12)}`);
    expect(bucket).toHaveLength(1);
    expect(bucket[0]?.reasonCode).toBe("large_drift");

    const offer = bucket[0]?.suggested;
    expect(offer).not.toBeNull();
    // After the meeting, and the session's own length - never a shortened one.
    expect(offer?.startsAt).toBeGreaterThanOrEqual(hour(15));
    expect((offer?.endsAt ?? 0) - (offer?.startsAt ?? 0)).toBe(30 * MINUTE);

    // Accepting is the move endpoint and nothing else: giving a bucketed slot
    // a time is what the status means, so the bucket needs no verb of its own.
    const accepted = await worker.default.fetch(
      `http://api/slots/${slotId}/move`,
      {
        method: "POST",
        headers: user.headers,
        body: JSON.stringify(offer),
      },
    );
    expect(accepted.status).toBe(204);

    const slot = await slotRow(slotId);
    expect(slot.status).toBe("planned");
    expect(slot.startsAt.getTime()).toBe(offer?.startsAt);
    // The user chose this time, so the next replan works around it.
    expect(slot.isLocked).toBe(true);

    expect(await get<BucketEntry[]>(user, `/bucket?at=${hour(12)}`)).toEqual(
      [],
    );
    const today = await get<{ slots: { id: string }[] }>(
      user,
      `/today?at=${hour(12)}`,
    );
    expect(today.slots.map((s) => s.id)).toContain(slotId);
  });

  test("dropping it is the cancel that already existed", async () => {
    const { user, calendarId, activityId } = await aDay();
    const slotId = await seedSlot(activityId, hour(10), 30);
    await seedMeeting(calendarId, hour(8), hour(18));
    await realignAfterSync(deps(user), hour(9), newId);

    const dropped = await worker.default.fetch(
      `http://api/slots/${slotId}/cancel`,
      { method: "POST", headers: user.headers, body: "{}" },
    );
    expect(dropped.status).toBe(204);

    expect((await slotRow(slotId)).status).toBe("cancelled");
    expect(await get<BucketEntry[]>(user, `/bucket?at=${hour(12)}`)).toEqual(
      [],
    );
  });
});

/**
 * Seeing the clash is free; the app doing something about it is not.
 *
 * The same gate `POST /plan` applies to a `calendar_change` trigger, checked
 * here as well because a push notification must not become a way around it.
 * What free still gets is the truth: a timeline that quietly draws a slot
 * underneath a meeting is worse than one that says so.
 */
test("a free plan is told, and left alone", async () => {
  const { user, calendarId, activityId } = await aDay("free");
  const slotId = await seedSlot(activityId, hour(10), 30);
  const eventId = await seedMeeting(calendarId, hour(10), hour(11));

  const outcome = await realignAfterSync(deps(user, "free"), hour(9), newId);
  expect(outcome).toEqual({ conflicts: 1, moved: 0, bucketed: 0 });

  const slot = await slotRow(slotId);
  expect(slot.status).toBe("planned");
  expect(slot.startsAt.getTime()).toBe(hour(10));
  expect(slot.conflictEventId).toBe(eventId);
});
