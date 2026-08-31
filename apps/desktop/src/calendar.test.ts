import {
  addDays,
  isoOf,
  midnightOf,
  monthCellsOf,
  weekDaysOf,
  weekStartOf,
} from "@wiseroutine/design";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * The date arithmetic the week and the month grids are built out of.
 *
 * Here rather than in the design package for the same reason as
 * `daygrid.test.ts`: that is where the kit's tests live, and neither needs a
 * second test runner in a package that has none.
 *
 * Every one of these is a rule the user can see - which column a day lands in,
 * which cell a slot is drawn against. A grid that is off by one is not a
 * cosmetic problem: it attaches this afternoon's stretch to yesterday.
 *
 * The whole file runs in one timezone, and a European one on purpose. These
 * are local-time functions, so a suite that ran in whatever zone the developer
 * happened to be in would pass in Dubai and fail in Rome - which is exactly
 * how the bug below survived being written.
 */

/** Vitest runs on Node, but the app is typed for a browser and does not carry
 *  `@types/node`. One line beats pulling Node's whole surface into the app's
 *  compile for the sake of a test's `env`. */
declare const process: { env: Record<string, string | undefined> };

const TZ = "Europe/London";
let restore: string | undefined;

beforeAll(() => {
  restore = process.env.TZ;
  process.env.TZ = TZ;
});
afterAll(() => {
  process.env.TZ = restore;
});

/** Months are zero-based in `Date`, and reading `9` as September is the
 *  easiest mistake to make in a file full of dates. */
const OCT = 9;
const NOV = 10;

describe("naming a day", () => {
  test("pads the month and the day, so days sort as strings", () => {
    expect(isoOf(new Date(2025, 0, 5))).toBe("2025-01-05");
  });

  test("midnight is local, not UTC - the whole grid hangs off this", () => {
    const noon = new Date(2025, OCT, 26, 12, 30);
    expect(isoOf(midnightOf(noon))).toBe("2025-10-26");
    expect(midnightOf(noon).getHours()).toBe(0);
  });
});

describe("the start of a week", () => {
  test("is the Monday", () => {
    // Wednesday.
    expect(isoOf(weekStartOf(new Date(2025, OCT, 8)))).toBe("2025-10-06");
  });

  test("leaves a Monday where it is", () => {
    expect(isoOf(weekStartOf(new Date(2025, OCT, 6)))).toBe("2025-10-06");
  });

  test("puts Sunday at the end of the week it began in, not the start of the next", () => {
    // The `(getDay() + 6) % 7` in `weekStartOf`, which is the one line in this
    // file it is genuinely easy to get backwards.
    expect(isoOf(weekStartOf(new Date(2025, OCT, 12)))).toBe("2025-10-06");
  });

  test("reaches back into the previous month, and the previous year", () => {
    expect(isoOf(weekStartOf(new Date(2025, OCT, 1)))).toBe("2025-09-29");
    expect(isoOf(weekStartOf(new Date(2026, 0, 1)))).toBe("2025-12-29");
  });
});

describe("moving a day at a time", () => {
  test("goes forwards and backwards, and over a month's end", () => {
    expect(isoOf(addDays(new Date(2025, OCT, 30), 3))).toBe("2025-11-02");
    expect(isoOf(addDays(new Date(2025, NOV, 2), -3))).toBe("2025-10-30");
  });

  test("lands on midnight whatever time it started from", () => {
    expect(addDays(new Date(2025, OCT, 8, 23, 59), 1).getHours()).toBe(0);
  });

  /**
   * The clocks go back on 26 October 2025, and that day is 25 hours long.
   *
   * This was a real bug: adding 24 hours' worth of milliseconds to that
   * midnight lands at 23:00 *the same evening*, and snapping that to midnight
   * gives the day it started from. The month grid drew 26 October twice and
   * every day after it was pulled back by one - so a whole month of slots hung
   * on the wrong dates, once a year, in every country that changes its clocks.
   */
  test("crosses the day the clocks go back", () => {
    expect(isoOf(addDays(new Date(2025, OCT, 26), 1))).toBe("2025-10-27");
  });

  test("crosses the day the clocks go forward", () => {
    expect(isoOf(addDays(new Date(2025, 2, 30), 1))).toBe("2025-03-31");
  });
});

describe("the seven columns of a week", () => {
  // Built inside each test, not once at the top: the timezone is set in
  // `beforeAll`, and a const up here would be computed before that ran - in
  // whatever zone the machine is in, which is the thing this file is pinning.
  const week = () =>
    weekDaysOf(weekStartOf(new Date(2025, OCT, 8)), new Date(2025, OCT, 8));

  test("are seven consecutive days, Monday first", () => {
    expect(week().map((day) => day.iso)).toEqual([
      "2025-10-06",
      "2025-10-07",
      "2025-10-08",
      "2025-10-09",
      "2025-10-10",
      "2025-10-11",
      "2025-10-12",
    ]);
  });

  test("marks today, and only today", () => {
    expect(
      week()
        .filter((day) => day.today)
        .map((day) => day.iso),
    ).toEqual(["2025-10-08"]);
    expect(week()[2]?.label).toContain("today");
  });

  test("marks the days behind us, and does not count today among them", () => {
    // Read-only and drawn back: a week you can still edit backwards is a week
    // that lets you plan yesterday.
    expect(
      week()
        .filter((day) => day.past)
        .map((day) => day.iso),
    ).toEqual(["2025-10-06", "2025-10-07"]);
  });

  test("survives the week the clocks change", () => {
    const days = weekDaysOf(
      weekStartOf(new Date(2025, OCT, 26)),
      new Date(2025, OCT, 26),
    );
    expect(new Set(days.map((day) => day.iso)).size).toBe(7);
    expect(days[6]?.iso).toBe("2025-10-26");
  });
});

describe("the six rows of a month", () => {
  const cells = () => monthCellsOf(2025, OCT, new Date(2025, OCT, 8));

  test("is six Monday-first weeks, so the grid never changes height", () => {
    expect(cells()).toHaveLength(42);
    expect(cells()[0]?.iso).toBe("2025-09-29");
    expect(cells()[41]?.iso).toBe("2025-11-09");
  });

  test("names every day exactly once", () => {
    // The DST bug showed up here first: 41 distinct days in 42 cells.
    expect(new Set(cells().map((cell) => cell.iso)).size).toBe(42);
  });

  test("says which days belong to the month and which are the neighbours", () => {
    expect(cells().filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(cells()[0]?.inMonth).toBe(false);
    expect(cells()[2]?.iso).toBe("2025-10-01");
    expect(cells()[2]?.inMonth).toBe(true);
  });

  test("marks today wherever it falls in the grid", () => {
    expect(
      cells()
        .filter((cell) => cell.today)
        .map((cell) => cell.iso),
    ).toEqual(["2025-10-08"]);
  });

  test("holds its shape through the month the clocks change", () => {
    // November 2025 leads with the last days of October, so it inherits the
    // same transition a week earlier in the grid than October does.
    for (const month of [OCT, NOV]) {
      const grid = monthCellsOf(2025, month, new Date(2025, OCT, 8));
      expect(new Set(grid.map((cell) => cell.iso)).size).toBe(42);
    }
  });

  test("starts on a Monday whichever day the first of the month is", () => {
    for (let month = 0; month < 12; month++) {
      const first = monthCellsOf(2025, month, new Date(2025, OCT, 8))[0];
      expect(new Date(`${first?.iso}T00:00`).getDay(), first?.iso).toBe(1);
    }
  });
});
