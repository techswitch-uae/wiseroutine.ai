import { monthCellsOf, weekDaysOf } from "@wiseroutine/design";
import { describe, expect, test } from "vitest";
import type { ScopeDay, ScopeResponse } from "./api";
import { monthCellsFrom, weekDaysFrom } from "./scope-view";

/** Tuesday 11 August 2026 - the day the design is drawn on. */
const TODAY = new Date(2026, 7, 11);
const MONDAY = new Date(2026, 7, 10);

/** 08:00-18:00, the default window a week is drawn against. */
const WINDOW = { startMinutes: 8 * 60, endMinutes: 18 * 60 };

/** A day's midnight as the server sends it - UTC here, so the arithmetic in
 *  the assertions is readable. */
const midnight = (day: number) => Date.UTC(2026, 7, day);
const at = (day: number, hour: number, minute = 0) =>
  midnight(day) + (hour * 60 + minute) * 60_000;

const day = (dayOfMonth: number, parts: Partial<ScopeDay> = {}): ScopeDay => ({
  iso: `2026-08-${String(dayOfMonth).padStart(2, "0")}`,
  dayStart: midnight(dayOfMonth),
  dayEnd: midnight(dayOfMonth + 1),
  slots: [],
  meetings: [],
  ...parts,
});

const answer = (days: ScopeDay[]): ScopeResponse => ({
  timeZone: "UTC",
  syncedAt: null,
  range: "working",
  ranges: [
    {
      key: "working",
      label: "Working hours",
      startMinutes: 480,
      endMinutes: 1080,
    },
  ],
  meetingsFrom: null,
  days,
});

const meeting = (
  id: string,
  from: number,
  to: number,
  extra: { title?: string | null; isAllDay?: boolean } = {},
) => ({
  id,
  // `?? "Standup"` would turn an explicitly null title back into a name, and
  // the null case is the one worth a test.
  title: extra.title === undefined ? "Standup" : extra.title,
  startsAt: from,
  endsAt: to,
  isAllDay: extra.isAllDay ?? false,
});

const slot = (
  id: string,
  from: number,
  to: number,
  status: ScopeDay["slots"][number]["status"] = "planned",
) => ({
  id,
  title: "Stretch",
  kind: "recovery" as const,
  startsAt: from,
  endsAt: to,
  status,
});

const week = (data: ScopeResponse | null) =>
  weekDaysFrom(weekDaysOf(MONDAY, TODAY), data, WINDOW);

describe("weekDaysFrom", () => {
  test("the scaffold survives an answer that has nothing in it", () => {
    const days = week(answer([]));
    expect(days).toHaveLength(7);
    expect(days.filter((d) => d.today)).toHaveLength(1);
    expect(days[0]?.blocks).toBeUndefined();
  });

  test("a meeting becomes a block that sits back, a slot one that comes forward", () => {
    const days = week(
      answer([
        day(10, {
          meetings: [meeting("m1", at(10, 9), at(10, 10))],
          slots: [slot("s1", at(10, 11), at(10, 11, 25))],
        }),
      ]),
    );

    expect(days[0]?.blocks).toEqual([
      {
        key: "2026-08-10-m1",
        startMinutes: 9 * 60,
        endMinutes: 10 * 60,
        title: "Standup",
        variant: "meeting",
      },
      {
        key: "2026-08-10-s1",
        startMinutes: 11 * 60,
        endMinutes: 11 * 60 + 25,
        title: "Stretch",
        variant: "slot",
        // Only the slot carries details - a meeting's popover would open to
        // say the title over again.
        detail: { when: "11:00–11:25", note: "Planned" },
      },
    ]);
  });

  test("a meeting is not pressable, so it carries no detail", () => {
    const days = week(
      answer([day(10, { meetings: [meeting("m1", at(10, 9), at(10, 10))] })]),
    );
    expect(days[0]?.blocks?.[0]?.detail).toBeUndefined();
  });

  test("the popover says the hours the slot runs, not the ones on screen", () => {
    // Starts before the window opens: the block is clamped to 08:00, and the
    // detail has to keep saying 07:30 or it reports the viewport as the plan.
    const days = week(
      answer([day(10, { slots: [slot("s1", at(10, 7, 30), at(10, 9))] })]),
    );

    expect(days[0]?.blocks?.[0]).toMatchObject({
      startMinutes: 8 * 60,
      detail: { when: "07:30–09:00" },
    });
  });

  test("meetings are ordered before slots, so slots paint on top of them", () => {
    const days = week(
      answer([
        day(10, {
          // The slot starts first, so a sort by time would put it underneath
          // the meeting it collides with - the one case worth seeing.
          meetings: [meeting("m1", at(10, 10), at(10, 11))],
          slots: [slot("s1", at(10, 9), at(10, 9, 25))],
        }),
      ]),
    );

    expect(days[0]?.blocks?.map((b) => b.variant)).toEqual(["meeting", "slot"]);
  });

  test("a running slot is the live one", () => {
    const days = week(
      answer([
        day(10, { slots: [slot("s1", at(10, 9), at(10, 10), "started")] }),
      ]),
    );
    expect(days[0]?.blocks?.[0]?.variant).toBe("live");
  });

  test("a meeting is clamped to the visible hours, not drawn above them", () => {
    const days = week(
      answer([day(10, { meetings: [meeting("m1", at(10, 6), at(10, 9))] })]),
    );

    expect(days[0]?.blocks?.[0]).toMatchObject({
      startMinutes: 8 * 60,
      endMinutes: 9 * 60,
    });
  });

  test("what the window misses entirely is counted, not drawn", () => {
    const days = week(
      answer([
        day(10, {
          meetings: [
            meeting("m1", at(10, 6), at(10, 7)),
            meeting("m2", at(10, 20), at(10, 21)),
            meeting("m3", at(10, 21), at(10, 22)),
          ],
        }),
      ]),
    );

    expect(days[0]?.blocks).toEqual([]);
    expect(days[0]?.note).toBe("1 earlier · 2 later");
  });

  test("a meeting ending exactly as the window opens is above it, not a block of no height", () => {
    const days = week(
      answer([day(10, { meetings: [meeting("m1", at(10, 7), at(10, 8))] })]),
    );

    expect(days[0]?.blocks).toEqual([]);
    expect(days[0]?.note).toBe("1 earlier");
  });

  test("a meeting running past midnight is drawn in both columns", () => {
    const spans = [at(10, 22), at(11, 9)] as const;
    const days = week(
      answer([
        day(10, { meetings: [meeting("m1", ...spans)] }),
        day(11, { meetings: [meeting("m1", ...spans)] }),
      ]),
    );

    // Monday's half is outside the window and only counted; Tuesday's is
    // clamped to the window's own start.
    expect(days[0]?.note).toBe("1 later");
    expect(days[1]?.blocks?.[0]).toMatchObject({
      key: "2026-08-11-m1",
      startMinutes: 8 * 60,
      endMinutes: 9 * 60,
    });
  });

  test("all-day events go to the strip, never into the grid", () => {
    const days = week(
      answer([
        day(10, {
          meetings: [
            meeting("m1", midnight(10), midnight(11), { isAllDay: true }),
            meeting("m2", at(10, 9), at(10, 10)),
          ],
        }),
      ]),
    );

    expect(days[0]?.allDay).toEqual([
      { key: "2026-08-10-m1", title: "Standup" },
    ]);
    expect(days[0]?.blocks?.map((b) => b.key)).toEqual(["2026-08-10-m2"]);
    // An all-day event is not a hidden one - it is shown, elsewhere.
    expect(days[0]?.note).toBeUndefined();
  });

  test("an account that stores no titles still gets a name to draw", () => {
    const days = week(
      answer([
        day(10, {
          meetings: [meeting("m1", at(10, 9), at(10, 10), { title: null })],
        }),
      ]),
    );
    expect(days[0]?.blocks?.[0]?.title).toBe("Busy");
  });

  test("no answer at all leaves the scaffold untouched", () => {
    expect(week(null)).toEqual(weekDaysOf(MONDAY, TODAY));
  });
});

describe("monthCellsFrom", () => {
  const cells = monthCellsOf(2026, 7, TODAY);
  const cellFor = (iso: string, data: ScopeResponse | null) =>
    monthCellsFrom(cells, data).find((c) => c.iso === iso);

  test("done and planned are counted apart", () => {
    const cell = cellFor(
      "2026-08-10",
      answer([
        day(10, {
          slots: [
            slot("s1", at(10, 9), at(10, 10), "completed"),
            slot("s2", at(10, 11), at(10, 12), "completed"),
            slot("s3", at(10, 13), at(10, 14), "planned"),
          ],
        }),
      ]),
    );

    expect(cell).toMatchObject({ done: 2, planned: 1 });
  });

  test("a skipped slot is neither done nor planned", () => {
    const cell = cellFor(
      "2026-08-10",
      answer([
        day(10, {
          slots: [
            slot("s1", at(10, 9), at(10, 10), "skipped"),
            slot("s2", at(10, 11), at(10, 12), "missed"),
          ],
        }),
      ]),
    );

    expect(cell?.done).toBeUndefined();
    expect(cell?.planned).toBeUndefined();
  });

  test("meetings are a count beside the date, and it is singular for one", () => {
    const one = cellFor(
      "2026-08-10",
      answer([day(10, { meetings: [meeting("m1", at(10, 9), at(10, 10))] })]),
    );
    const several = cellFor(
      "2026-08-12",
      answer([
        day(12, {
          meetings: [
            meeting("m1", at(12, 9), at(12, 10)),
            meeting("m2", at(12, 11), at(12, 12)),
          ],
        }),
      ]),
    );

    expect(one?.note).toBe("1 mtg");
    expect(several?.note).toBe("2 mtgs");
  });

  test("no answer at all leaves the scaffold untouched", () => {
    expect(monthCellsFrom(cells, null)).toEqual(cells);
  });
});
