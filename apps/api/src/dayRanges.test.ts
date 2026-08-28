import { describe, expect, test } from "vitest";
import { type DayRangeSettings, dayRanges, resolveRange } from "./dayRanges";

const settings = (patch: Partial<DayRangeSettings> = {}): DayRangeSettings => ({
  dayStartMinutes: 510,
  dayEndMinutes: 1050,
  customRangeLabel: null,
  customRangeStartMinutes: null,
  customRangeEndMinutes: null,
  dayOpensOn: "working",
  ...patch,
});

const evenings = {
  customRangeLabel: "Studio evenings",
  customRangeStartMinutes: 1020,
  customRangeEndMinutes: 1320,
};

describe("dayRanges", () => {
  test("working hours track the planning window", () => {
    expect(dayRanges(settings())[0]).toMatchObject({
      key: "working",
      startMinutes: 510,
      endMinutes: 1050,
    });
  });

  test("the custom range appears only once it is fully configured", () => {
    expect(dayRanges(settings()).map((r) => r.key)).toEqual([
      "working",
      "full",
    ]);

    // A label with no hours is not selectable, so it is not offered.
    expect(
      dayRanges(settings({ customRangeLabel: "Studio evenings" })).map(
        (r) => r.key,
      ),
    ).toEqual(["working", "full"]);

    expect(dayRanges(settings(evenings)).at(-1)).toMatchObject({
      key: "custom",
      label: "Studio evenings",
      startMinutes: 1020,
    });
  });
});

describe("resolveRange", () => {
  test("what was asked for wins over what the day opens on", () => {
    expect(
      resolveRange(settings({ ...evenings, dayOpensOn: "custom" }), "full").key,
    ).toBe("full");
  });

  test("falls back to the opening range when nothing was asked for", () => {
    expect(
      resolveRange(settings({ ...evenings, dayOpensOn: "custom" })).key,
    ).toBe("custom");
  });

  // The case that would otherwise show an empty day: the range someone's
  // settings still name no longer exists.
  test("a range that no longer exists falls back to working hours", () => {
    expect(resolveRange(settings({ dayOpensOn: "custom" })).key).toBe(
      "working",
    );
    expect(resolveRange(settings(), "custom").key).toBe("working");
  });
});
