import { describe, expect, it } from "vitest";
import type { ActivityProgress } from "./api";
import { buildTimeline, openGaps, type TodayResponse } from "./api";
import { owedToday } from "./owed";

const H = (hour: number, minute = 0): number =>
  Date.UTC(2026, 7, 11, hour, minute);

const day = (over: Partial<TodayResponse> = {}): TodayResponse => ({
  date: { year: 2026, month: 8, day: 11 },
  timeZone: "UTC",
  dayStart: H(9),
  dayEnd: H(17),
  range: "working",
  ranges: [],
  slots: [],
  meetings: [],
  outside: { before: [], after: [] },
  syncedAt: null,
  modules: [],
  progress: [],
  ...over,
});

const meeting = (from: number, to: number, id = `m${from}`) => ({
  id,
  title: "Design review",
  startsAt: from,
  endsAt: to,
  isAllDay: false,
});

const slot = (from: number, to: number, id = `s${from}`) => ({
  id,
  title: "Deep work",
  kind: "focus" as const,
  startsAt: from,
  endsAt: to,
  status: "planned" as const,
  isLocked: false,
  conflictEventId: null,
});

describe("openGaps", () => {
  it("finds the stretches a meeting leaves behind", () => {
    const gaps = openGaps(day({ meetings: [meeting(H(10), H(11))] }), H(9));
    expect(gaps.map((g) => g.minutes)).toEqual([60, 360]);
  });

  it("treats the day's own slots as occupied", () => {
    // A gap the timeline is already drawing a stretch in is not free, and
    // offering it would be offering a collision with the user's own plan.
    const gaps = openGaps(day({ slots: [slot(H(10), H(11))] }), H(9));
    expect(gaps.map((g) => g.minutes)).toEqual([60, 360]);
  });

  it("never offers time that has already gone", () => {
    const gaps = openGaps(day(), H(14));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.startsAt).toBe(H(14));
    expect(gaps[0]?.minutes).toBe(180);
  });

  it("drops a hole too short to put anything in", () => {
    const packed = day({
      meetings: [meeting(H(9), H(12)), meeting(H(12, 3), H(17), "m2")],
    });
    expect(openGaps(packed, H(9))).toEqual([]);
  });

  it("ignores an all-day event, which is metadata rather than busy time", () => {
    const withHoliday = day({
      meetings: [{ ...meeting(H(0), H(24)), isAllDay: true }],
    });
    expect(openGaps(withHoliday, H(9)).map((g) => g.minutes)).toEqual([480]);
  });

  it("has nothing to offer on a day with no room at all", () => {
    expect(openGaps(day({ meetings: [meeting(H(9), H(17))] }), H(9))).toEqual(
      [],
    );
  });
});

const progress = (over: Partial<ActivityProgress>): ActivityProgress => ({
  id: "a",
  name: "Shoulder stretch",
  kind: "recovery",
  minimumType: "countPerDay",
  minimumValue: 3,
  sessionMinutes: 10,
  count: 0,
  minutes: 0,
  ...over,
});

describe("owedToday", () => {
  it("counts what is left of a per-day count", () => {
    expect(owedToday([progress({ count: 1 })])[0]?.left).toBe(2);
  });

  it("leaves out anything already finished", () => {
    expect(owedToday([progress({ count: 3 })])).toEqual([]);
  });

  it("turns a duration minimum into whole sessions, rounded up", () => {
    // 40 minutes left of two hours, in 25-minute blocks, is two more blocks -
    // not 1.6, and not one.
    const row = progress({
      minimumType: "durationPerDay",
      minimumValue: 120,
      sessionMinutes: 25,
      minutes: 80,
    });
    expect(owedToday([row])[0]?.left).toBe(2);
  });

  it("does not divide by zero when an activity has no session length", () => {
    const row = progress({
      minimumType: "durationPerDay",
      minimumValue: 60,
      sessionMinutes: 0,
      minutes: 0,
    });
    expect(owedToday([row])[0]?.left).toBe(60);
  });

  it("carries the session length through, which is what the tray offers", () => {
    expect(owedToday([progress({ sessionMinutes: 10 })])[0]?.minutes).toBe(10);
  });
});

/**
 * Which blocks the day lets you pick up.
 *
 * Dragging is how a slot is rescheduled, so it has to stop being offered the
 * moment there is nothing left to reschedule. A slot that has started is
 * happening now; a completed, skipped or missed one is the record that it
 * happened - or did not - at a particular time, and both the missed list and
 * every progress number are read back out of those rows.
 */
describe("buildTimeline", () => {
  const status = (value: string) =>
    buildTimeline(
      day({
        slots: [{ ...slot(H(10), H(11)), status: value as "planned" }],
      }),
      H(9),
    )[0];

  it("lets you move a slot that is still ahead of you", () => {
    expect(status("planned")?.movable).toBe(true);
    expect(status("live")?.movable).toBe(true);
  });

  it("pins one that has begun or is over", () => {
    for (const value of ["started", "completed", "skipped", "missed"]) {
      expect(status(value)?.movable).toBe(false);
    }
  });

  // We never write back to the calendar it came from, so a block that slides
  // but changes nothing would be saying we do.
  it("never lets you move a meeting", () => {
    const rows = buildTimeline(
      day({ meetings: [meeting(H(10), H(11))] }),
      H(9),
    );
    expect(rows[0]?.movable).toBeUndefined();
  });
});
