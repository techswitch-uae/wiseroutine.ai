import { describe, expect, test } from "vitest";
import { plan } from "./plan";
import { maxDailySessions, siblingGap } from "./routine";
import type { Activity, PlanInput } from "./types";

const M = 60_000;
const H = 60 * M;
const activity: Activity = {
  id: "stretch",
  name: "Stretch",
  kind: "recovery",
  isActive: true,
  minimum: { type: "countPerDay", value: 3 },
  sessionMinutes: 10,
  importance: "normal",
  bufferBeforeMeetingMinutes: 0,
  daysOfWeek: 127,
};
const day = (over: Partial<PlanInput> = {}): PlanInput => ({
  dayStart: 9 * H,
  dayEnd: 17 * H,
  busy: [],
  locked: [],
  demands: [{ activity, sessionsNeeded: 3, preferredAt: [] }],
  ...over,
});

describe("daily frequency", () => {
  test.each([
    [1, 12],
    [5, 12],
    [10, 12],
    [15, 8],
    [20, 6],
    [25, 4],
    [30, 4],
    [35, 3],
    [60, 2],
    [65, 1],
    [120, 1],
    [480, 1],
  ])("%i minutes permits %i occurrences", (minutes, max) => {
    expect(maxDailySessions(minutes)).toBe(max);
  });
  test("the limit never increases as duration increases", () => {
    for (let minutes = 2; minutes <= 480; minutes++)
      expect(maxDailySessions(minutes)).toBeLessThanOrEqual(
        maxDailySessions(minutes - 1),
      );
  });
});

describe("repeated placement", () => {
  test("three stretches span morning, midday and afternoon", () => {
    const result = plan(day());
    expect(result.placed.map((s) => s.start / M)).toEqual([615, 775, 935]);
    expect(result.unplaced).toEqual([]);
    expect(plan(day())).toEqual(result);
  });
  test.each(["focus", "recovery", "task"] as const)(
    "spreads every activity kind: %s",
    (kind) => {
      const result = plan(
        day({
          demands: [
            {
              activity: { ...activity, kind },
              sessionsNeeded: 3,
              preferredAt: [10 * H],
            },
          ],
        }),
      );
      expect(result.placed).toHaveLength(3);
      for (let i = 1; i < result.placed.length; i++)
        expect(
          result.placed[i]!.start - result.placed[i - 1]!.end,
        ).toBeGreaterThanOrEqual(siblingGap(8 * H, 3));
    },
  );
  test("a shorter working day borrows edge padding so four half-hours still fit with spacing", () => {
    const result = plan(
      day({
        dayEnd: 13 * H,
        demands: [
          {
            activity: { ...activity, sessionMinutes: 30 },
            sessionsNeeded: 4,
            preferredAt: [],
          },
        ],
      }),
    );
    expect(result.placed).toHaveLength(4);
    expect(result.unplaced).toEqual([]);
    for (let i = 1; i < result.placed.length; i++)
      expect(
        result.placed[i]!.start - result.placed[i - 1]!.end,
      ).toBeGreaterThanOrEqual(siblingGap(4 * H, 4));
  });

  test("an accepted occurrence consumes a target and is never moved", () => {
    const locked = {
      activityId: activity.id,
      start: 10 * H,
      end: 10 * H + 10 * M,
    };
    const result = plan(
      day({
        locked: [locked],
        demands: [{ activity, sessionsNeeded: 2, preferredAt: [] }],
      }),
    );
    expect(result.placed).toHaveLength(3);
    expect(result.placed[0]).toEqual(locked);
    expect(result.placed[1]!.start).toBeGreaterThanOrEqual(12 * H);
    expect(result.placed[2]!.start).toBeGreaterThanOrEqual(15 * H);
  });
  test("late placement never uses the past or compresses missed targets into a clump", () => {
    const result = plan(day({ spreadStart: 9 * H, dayStart: 14 * H }));
    expect(
      result.placed.every((s) => s.start >= 14 * H && s.end <= 17 * H),
    ).toBe(true);
    expect(result.placed).toHaveLength(2);
    expect(
      result.placed[1]!.start - result.placed[0]!.end,
    ).toBeGreaterThanOrEqual(siblingGap(8 * H, 3));
    expect(result.unplaced).toEqual([
      { activityId: activity.id, sessions: 1, reason: "spacing_blocked" },
    ]);
  });
  test("a narrow morning gap cannot collect all three stretches", () => {
    const result = plan(
      day({
        busy: [{ start: 10 * H, end: 17 * H, sourceEventIds: ["meeting"] }],
      }),
    );
    expect(result.placed).toHaveLength(1);
    expect(result.unplaced).toEqual([
      { activityId: activity.id, sessions: 2, reason: "spacing_blocked" },
    ]);
  });
  test("multiple competing activities conserve every occurrence and never overlap", () => {
    const result = plan(
      day({
        demands: Array.from({ length: 8 }, (_, i) => ({
          activity: { ...activity, id: String(i), sessionMinutes: 30 },
          sessionsNeeded: 4,
          preferredAt: [],
        })),
      }),
    );
    expect(
      result.placed.length +
        result.unplaced.reduce((sum, item) => sum + item.sessions, 0),
    ).toBe(32);
    for (let i = 1; i < result.placed.length; i++)
      expect(result.placed[i]!.start).toBeGreaterThanOrEqual(
        result.placed[i - 1]!.end,
      );
    for (const slot of result.placed)
      expect(slot.end - slot.start).toBe(30 * M);
  });
});
