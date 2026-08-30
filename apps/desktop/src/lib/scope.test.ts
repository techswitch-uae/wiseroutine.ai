import {
  isoOf,
  monthCellsOf,
  weekDaysOf,
  weekStartOf,
} from "@wiseroutine/design";
import { describe, expect, test } from "vitest";
import {
  dayOf,
  monthKey,
  monthOf,
  periodLabel,
  scopeOf,
  weekLabel,
} from "./scope";

/** Tuesday 11 August 2026 - the day the design is drawn on. */
const TODAY = new Date(2026, 7, 11);

describe("week", () => {
  test("starts on Monday, whatever day it is given", () => {
    // Tuesday and the Sunday that ends the same week must agree.
    expect(isoOf(weekStartOf(TODAY))).toBe("2026-08-10");
    expect(isoOf(weekStartOf(new Date(2026, 7, 16)))).toBe("2026-08-10");
    expect(isoOf(weekStartOf(new Date(2026, 7, 10)))).toBe("2026-08-10");
  });

  test("seven days, with today marked and earlier ones past", () => {
    const days = weekDaysOf(weekStartOf(TODAY), TODAY);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.iso).at(-1)).toBe("2026-08-16");
    expect(days.filter((d) => d.today)).toHaveLength(1);
    expect(days.filter((d) => d.past)).toHaveLength(1);
  });

  test("names its month once when it can, twice when it must", () => {
    expect(weekLabel(weekStartOf(TODAY))).toBe("10–16 August");
    // 27 July - 2 August: one label cannot cover both.
    expect(weekLabel(new Date(2026, 6, 27))).toBe("27 July – 2 August");
  });
});

describe("month", () => {
  test("six Monday-first rows, with the neighbours filled in", () => {
    const cells = monthCellsOf(2026, 7, TODAY);
    expect(cells).toHaveLength(42);
    expect(cells[0]?.iso).toBe("2026-07-27");
    expect(cells[0]?.inMonth).toBe(false);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.find((c) => c.today)?.iso).toBe("2026-08-11");
  });

  test("a day before today is past, today itself is not", () => {
    const cells = monthCellsOf(2026, 7, TODAY);
    expect(cells.find((c) => c.iso === "2026-08-10")?.past).toBe(true);
    expect(cells.find((c) => c.iso === "2026-08-11")?.past).toBeUndefined();
  });
});

describe("search parameters", () => {
  test("a date that does not exist falls back rather than rolling over", () => {
    expect(isoOf(dayOf("2026-08-20", TODAY))).toBe("2026-08-20");
    // 31 February parses as 3 March; taking that would show a month the URL
    // never asked for.
    expect(isoOf(dayOf("2026-02-31", TODAY))).toBe("2026-08-11");
    expect(isoOf(dayOf(undefined, TODAY))).toBe("2026-08-11");
    expect(isoOf(dayOf("nonsense", TODAY))).toBe("2026-08-11");
  });

  test("month rejects what it cannot use", () => {
    expect(monthOf("2027-01", TODAY)).toEqual({ year: 2027, month: 0 });
    expect(monthOf("2027-13", TODAY)).toEqual({ year: 2026, month: 7 });
    expect(monthOf(undefined, TODAY)).toEqual({ year: 2026, month: 7 });
    expect(monthKey(2026, 7)).toBe("2026-08");
  });

  test("the sidebar's period comes from the path and the search alone", () => {
    expect(scopeOf("/")).toBe("day");
    expect(scopeOf("/week")).toBe("week");
    // Not a scope of the calendar, so none of the four is current. Falling
    // back to "day" here left Day lit in the rail alongside Activities.
    expect(scopeOf("/activities")).toBeNull();
    expect(scopeOf("/calendars")).toBeNull();
    expect(scopeOf("/settings")).toBeNull();
    expect(periodLabel(null, {}, TODAY)).toBeUndefined();

    // Day names the day on screen, which is today until it is paged away from.
    expect(periodLabel("day", {}, TODAY)).toBe("11 Aug");
    expect(periodLabel("day", { date: "2026-08-19" }, TODAY)).toBe("19 Aug");
    expect(periodLabel("week", {}, TODAY)).toBe("10–16 Aug");
    expect(periodLabel("week", { start: "2026-08-24" }, TODAY)).toBe(
      "24–30 Aug",
    );
    expect(periodLabel("month", { m: "2026-11" }, TODAY)).toBe("November");
  });
});
