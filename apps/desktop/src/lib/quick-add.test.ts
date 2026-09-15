import { expect, test } from "vitest";
import type { ScopeDay, TodayResponse } from "./api";
import { durationsFor, suggestionsFor } from "./quick-add";
import { fitsAt } from "./todos";

/** Tuesday 1 September 2026, a day drawn from 08:00 to 18:00 UTC. */
const H = 3_600_000;
const M = 60_000;
const DAY_START = Date.UTC(2026, 8, 1, 8);
const DAY_END = Date.UTC(2026, 8, 1, 18);

const day = (over: Partial<TodayResponse> = {}): TodayResponse => ({
  date: { year: 2026, month: 9, day: 1 },
  timeZone: "UTC",
  dayStart: DAY_START,
  dayEnd: DAY_END,
  range: "working",
  ranges: [
    { key: "working", label: "Working", startMinutes: 480, endMinutes: 1080 },
  ],
  slots: [],
  meetings: [],
  outside: { before: [], after: [] },
  syncedAt: null,
  widgets: [],
  ...over,
});

const meeting = (startsAt: number, endsAt: number) => ({
  id: "m",
  title: "Client sync",
  startsAt,
  endsAt,
  isAllDay: false,
});

test("four lengths around the default, the default among them", () => {
  expect(durationsFor(10)).toEqual([5, 10, 15, 20]);
  expect(durationsFor(50)).toEqual([45, 50, 60, 90]);
  expect(durationsFor(90)).toEqual([30, 45, 60, 90]);
});

test("now on the grid, then after the meeting, then tomorrow's first gap", () => {
  const now = Date.UTC(2026, 8, 1, 11, 38);
  const today = day({
    meetings: [meeting(Date.UTC(2026, 8, 1, 12), Date.UTC(2026, 8, 1, 13))],
  });
  const tomorrow: ScopeDay = {
    iso: "2026-09-02",
    // Bounded at midnight, as `/scope` bounds it.
    dayStart: Date.UTC(2026, 8, 2),
    dayEnd: Date.UTC(2026, 8, 3),
    slots: [],
    meetings: [meeting(DAY_START + 24 * H, DAY_START + 24 * H + 30 * M)],
  };

  const rows = suggestionsFor(15, today, tomorrow, now);
  expect(rows.map((r) => [r.when, r.title, r.at])).toEqual([
    ["11:40", "Now, on the grid", Date.UTC(2026, 8, 1, 11, 40)],
    ["13:00", "Later today", Date.UTC(2026, 8, 1, 13)],
    ["Wed", "Tomorrow, 08:30", DAY_START + 24 * H + 30 * M],
  ]);

  // Tomorrow is narrowed to the hours today is drawn against - `/scope`
  // bounds it at midnight, and nobody wants a stretch at 00:00.
  const working = day({
    range: "working",
    ranges: [
      { key: "working", label: "Working", startMinutes: 540, endMinutes: 1080 },
    ],
  });
  expect(suggestionsFor(15, working, tomorrow, now).at(-1)?.title).toBe(
    "Tomorrow, 09:00",
  );
});

test("where a todo fits: the next mark, or nowhere when the day is nearly over", () => {
  expect(fitsAt(10, day(), Date.UTC(2026, 8, 1, 11, 38))).toBe(
    Date.UTC(2026, 8, 1, 11, 40),
  );
  const late = Date.UTC(2026, 8, 1, 17, 50);
  expect(fitsAt(10, day(), late)).toBe(late);
  expect(fitsAt(15, day(), late)).toBeNull();
  expect(fitsAt(15, null, late)).toBeNull();
});
