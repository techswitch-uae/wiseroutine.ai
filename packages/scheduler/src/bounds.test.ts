import { expect, test } from "vitest";
import { NO_PROGRESS, sessionsNeededToday } from "./demand";
import { plan } from "./plan";
import type { Activity, PlanInput } from "./types";

const activity: Activity = {
  id: "a",
  name: "Focus",
  kind: "focus",
  isActive: true,
  minimum: { type: "durationPerDay", value: 60 },
  sessionMinutes: 10,
  importance: "normal",
  bufferBeforeMeetingMinutes: 0,
  daysOfWeek: 127,
};
const input = (): PlanInput => ({
  dayStart: 0,
  dayEnd: 86400000,
  busy: [],
  locked: [],
  demands: [{ activity, sessionsNeeded: 6, preferredAt: [] }],
});
test.each([0, -1, NaN, Infinity])(
  "invalid duration %s cannot create infinite demand or zero-length placements",
  (sessionMinutes) => {
    const invalid = { ...activity, sessionMinutes };
    expect(() => sessionsNeededToday(invalid, NO_PROGRESS, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      plan({
        ...input(),
        demands: [{ activity: invalid, sessionsNeeded: 1, preferredAt: [] }],
      }),
    ).toThrow(RangeError);
  },
);
test.each([Infinity, NaN, -1, 1e9, 1.5])(
  "invalid or excessive demand %s is refused",
  (sessionsNeeded) => {
    expect(() =>
      plan({
        ...input(),
        demands: [{ activity, sessionsNeeded, preferredAt: [] }],
      }),
    ).toThrow(RangeError);
  },
);
test("bounded input and work budgets defend non-HTTP callers", () => {
  expect(() => plan({ ...input(), dayEnd: Infinity })).toThrow(RangeError);
  expect(() =>
    plan({ ...input(), demands: Array(1001).fill(input().demands[0]) }),
  ).toThrow(RangeError);
  expect(() =>
    plan({
      ...input(),
      demands: [{ activity, sessionsNeeded: 1, preferredAt: [NaN] }],
    }),
  ).toThrow(RangeError);
  const busy = Array.from({ length: 300 }, (_, i) => ({
    sourceEventIds: [String(i)],
    start: i * 100000,
    end: i * 100000 + 1000,
  }));
  expect(() =>
    plan({ ...input(), busy, demands: Array(1000).fill(input().demands[0]) }),
  ).toThrow("work bounds");
});
test("valid duration minima still produce finite, non-overlapping placements", () => {
  const result = plan(input());
  expect(result.placed).toHaveLength(6);
  expect(result.placed.every((s) => s.end > s.start)).toBe(true);
});
