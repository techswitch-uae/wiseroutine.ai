import type { ActivityRow, SlotRow, SlotStatus } from "@wiseroutine/db";
import { describe, expect, test } from "vitest";
import { type RepairInput, repair } from "./repair";

/**
 * The mapping, not the placement.
 *
 * Where a session lands is `rearrange`'s decision and is tested against sixty
 * days of it in `packages/scheduler` - repeating any of that here would only
 * mean two suites to update for one rule change. What is this file's own is
 * the translation into things a database can hold, and the two ways it could
 * go wrong are both silent: a `suggested` applied as though the user had
 * agreed to it, and a `blocked` dropped on the floor.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** An arbitrary instant. Nothing here reads a wall clock. */
const DAY = 1_800_000_000_000;

const day = { now: DAY, dayStart: DAY, dayEnd: DAY + 8 * HOUR };

const busy = (start: number, end: number) => ({
  start,
  end,
  sourceEventIds: ["meeting"],
});

const slot = (over: Partial<SlotRow> = {}): SlotRow => ({
  id: "s1",
  activityId: "a1",
  reminderId: null,
  title: "Deep work",
  kind: "focus",
  startsAt: DAY + HOUR,
  endsAt: DAY + HOUR + 30 * MINUTE,
  timeZone: "UTC",
  status: "planned" as SlotStatus,
  isLocked: false,
  conflictEventId: null,
  conflictSeverity: null,
  autoMoveCount: 0,
  ownerAddonId: null,
  planRunId: null,
  createdAt: DAY,
  ...over,
});

/** Only the ten fields `toSchedulerActivity` reads. The rest of the row is
 *  storage the solver never sees. */
const activity = {
  row: {
    id: "a1",
    name: "Deep work",
    kind: "focus",
    isActive: true,
    minimumType: "countPerDay",
    minimumValue: 2,
    sessionMinutes: 30,
    importance: "normal",
    bufferBeforeMeetingMinutes: 0,
    daysOfWeek: 0b1111111,
  } as ActivityRow,
  anchorMinutes: [],
};

const run = (over: Partial<RepairInput>) =>
  repair({ ...day, busy: [], slots: [], activities: [activity], ...over });

describe("a meeting lands on a slot", () => {
  test("a repair the engine stands behind is applied", () => {
    const result = run({
      busy: [busy(DAY + HOUR, DAY + 2 * HOUR)],
      slots: [slot()],
    });

    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]?.slotId).toBe("s1");
    expect(result.bucket).toEqual([]);
    // Length is never traded for a fit: half a focus block is a different
    // session wearing the same name.
    const move = result.moves[0];
    expect((move?.endsAt ?? 0) - (move?.startsAt ?? 0)).toBe(30 * MINUTE);
  });

  /**
   * The one thing this file exists to stop.
   *
   * A position that leaves the window, or moves far enough to be a different
   * plan, is a question - and a question answered by writing it to the day is
   * not a question. It goes to the bucket carrying the position, so the user
   * can accept it in one press.
   */
  test("a position that is a decision is offered, never applied", () => {
    const result = run({
      // Five hours of meeting from the top of the day, so the only room left
      // is far from where the slot was.
      busy: [busy(DAY, DAY + 5 * HOUR)],
      slots: [slot({ startsAt: DAY + 30 * MINUTE, endsAt: DAY + HOUR })],
    });

    expect(result.moves).toEqual([]);
    expect(result.bucket).toHaveLength(1);
    expect(result.bucket[0]?.reason).toBe("large_drift");
    expect(result.bucket[0]?.fromStartsAt).toBe(DAY + 30 * MINUTE);
    // The proposal travels with it. Without this the bucket could only say
    // "somewhere", and accepting would mean choosing a time from scratch.
    expect(result.bucket[0]?.toStartsAt).toBeGreaterThan(DAY + 5 * HOUR);
  });

  test("nowhere at all is handed back, not guessed at", () => {
    const result = run({
      busy: [busy(DAY, DAY + 8 * HOUR)],
      slots: [slot()],
    });

    expect(result.moves).toEqual([]);
    expect(result.bucket).toHaveLength(1);
    expect(result.bucket[0]?.reason).toBe("no_gap");
    // No position, so no offer. A bucket row that invented one would be the
    // app guessing where a session goes and calling it a suggestion.
    expect(result.bucket[0]?.toStartsAt).toBeUndefined();
  });
});

/**
 * Already in the bucket, so it holds no time.
 *
 * Without the filter a bucketed session would be found "broken" by every
 * later sync and bucketed again, and - worse - would count as occupying the
 * hour it was displaced from, so nothing else could be repaired into it.
 */
test("a session already in the bucket is left out of the day", () => {
  const result = run({
    busy: [busy(DAY, DAY + 8 * HOUR)],
    slots: [slot({ status: "bucketed" })],
  });

  expect(result).toEqual({ moves: [], bucket: [], frozen: [] });
});

/** A slot the clock has already started is reported, never relocated - even
 *  when a meeting is sitting on it. */
test("a running session is reported rather than moved", () => {
  const result = run({
    now: DAY + 70 * MINUTE,
    busy: [busy(DAY + HOUR, DAY + 2 * HOUR)],
    slots: [slot({ status: "started" })],
  });

  expect(result.frozen).toEqual(["s1"]);
  expect(result.moves).toEqual([]);
  expect(result.bucket).toEqual([]);
});
