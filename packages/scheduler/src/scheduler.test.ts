import { describe, expect, test } from "vitest";
import { freeGaps, isBusy, toBusyBlocks } from "./busy";
import { NO_PROGRESS, sessionsNeededToday } from "./demand";
import {
  dayBounds,
  instantFromLocal,
  localWeekday,
  preferredInstant,
  zoneOffsetMs,
} from "./localtime";
import { plan } from "./plan";
import type { Activity, CalendarEvent, Demand, PlanInput } from "./types";

const ZONE = "Europe/Rome";
const EVERY_DAY = 0b1111111;

/** 2026-08-24 is a Monday. Times are local to ZONE. */
const DATE = { year: 2026, month: 8, day: 24 };
const at = (hour: number, minute = 0) =>
  instantFromLocal({ ...DATE, hour, minute }, ZONE).instant;

const event = (
  over: Partial<CalendarEvent> & Pick<CalendarEvent, "id">,
): CalendarEvent => ({
  calendarId: "cal-1",
  start: at(10),
  end: at(11),
  isAllDay: false,
  kind: "default",
  busyStatus: "busy",
  responseStatus: "accepted",
  isCancelled: false,
  ...over,
});

const activity = (
  over: Partial<Activity> & Pick<Activity, "id">,
): Activity => ({
  name: over.id,
  kind: "recovery",
  isActive: true,
  minimum: { type: "countPerDay", value: 1 },
  sessionMinutes: 10,
  importance: "normal",
  bufferBeforeMeetingMinutes: 0,
  daysOfWeek: EVERY_DAY,
  ...over,
});

const demand = (
  a: Activity,
  sessionsNeeded = 1,
  preferredAt: number[] = [],
): Demand => ({
  activity: a,
  sessionsNeeded,
  preferredAt,
});

const asLocal = (instant: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));

/* ── The free/busy rules — the highest-risk logic in the project ─────────── */

describe("isBusy", () => {
  test("a plain accepted meeting is busy", () => {
    expect(isBusy(event({ id: "e" }))).toBe(true);
  });

  // The bug that makes every user appear to have zero free time.
  test("working-location events are never busy", () => {
    expect(
      isBusy(
        event({ id: "e", kind: "workingLocation", start: at(9), end: at(18) }),
      ),
    ).toBe(false);
  });

  test("birthdays and Gmail-derived events are never busy", () => {
    expect(isBusy(event({ id: "e", kind: "birthday", isAllDay: true }))).toBe(
      false,
    );
    expect(isBusy(event({ id: "e", kind: "fromGmail" }))).toBe(false);
  });

  test("a declined meeting is not busy", () => {
    expect(isBusy(event({ id: "e", responseStatus: "declined" }))).toBe(false);
  });

  test("an event marked free is not busy", () => {
    expect(isBusy(event({ id: "e", busyStatus: "free" }))).toBe(false);
  });

  test("a cancelled event is not busy", () => {
    expect(isBusy(event({ id: "e", isCancelled: true }))).toBe(false);
  });

  test("all-day events are not busy by default, but out-of-office is", () => {
    expect(isBusy(event({ id: "e", isAllDay: true }))).toBe(false);
    expect(isBusy(event({ id: "e", isAllDay: true, busyStatus: "oof" }))).toBe(
      true,
    );
    expect(
      isBusy(event({ id: "e", isAllDay: true }), { allDayIsBusy: true }),
    ).toBe(true);
  });

  test("tentative is busy by default and configurable", () => {
    const e = event({ id: "e", busyStatus: "tentative" });
    expect(isBusy(e)).toBe(true);
    expect(isBusy(e, { tentativeIsBusy: false })).toBe(false);
  });
});

describe("toBusyBlocks", () => {
  test("deduplicates the same meeting across two calendars", () => {
    const blocks = toBusyBlocks([
      event({ id: "work", calendarId: "work", icalUid: "shared@uid" }),
      event({ id: "personal", calendarId: "personal", icalUid: "shared@uid" }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.sourceEventIds).toEqual(["work"]);
  });

  test("merges overlapping meetings into one block", () => {
    const blocks = toBusyBlocks([
      event({ id: "a", start: at(10), end: at(11) }),
      event({ id: "b", start: at(10, 30), end: at(12) }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(asLocal(blocks[0]?.start ?? 0)).toBe("10:00");
    expect(asLocal(blocks[0]?.end ?? 0)).toBe("12:00");
    expect(blocks[0]?.sourceEventIds).toEqual(["a", "b"]);
  });

  test("keeps separate meetings separate", () => {
    const blocks = toBusyBlocks([
      event({ id: "a", start: at(10), end: at(11) }),
      event({ id: "b", start: at(14), end: at(15) }),
    ]);
    expect(blocks).toHaveLength(2);
  });
});

describe("freeGaps", () => {
  test("returns the complement within bounds", () => {
    const gaps = freeGaps({ start: at(9), end: at(17) }, [
      { start: at(10), end: at(11) },
    ]);
    expect(gaps.map((g) => [asLocal(g.start), asLocal(g.end)])).toEqual([
      ["09:00", "10:00"],
      ["11:00", "17:00"],
    ]);
  });

  test("clips busy blocks that extend past the bounds", () => {
    const gaps = freeGaps({ start: at(9), end: at(17) }, [
      { start: at(8), end: at(10) },
    ]);
    expect(gaps.map((g) => [asLocal(g.start), asLocal(g.end)])).toEqual([
      ["10:00", "17:00"],
    ]);
  });

  test("a fully booked day has no gaps", () => {
    expect(
      freeGaps({ start: at(9), end: at(17) }, [{ start: at(9), end: at(17) }]),
    ).toEqual([]);
  });
});

/* ── Minimums ────────────────────────────────────────────────────────────── */

describe("sessionsNeededToday", () => {
  const monday = 1;

  test("countPerDay subtracts what is done", () => {
    const a = activity({
      id: "eye-rest",
      minimum: { type: "countPerDay", value: 4 },
    });
    expect(sessionsNeededToday(a, NO_PROGRESS, monday)).toBe(4);
    expect(
      sessionsNeededToday(a, { ...NO_PROGRESS, completedToday: 3 }, monday),
    ).toBe(1);
    expect(
      sessionsNeededToday(a, { ...NO_PROGRESS, completedToday: 9 }, monday),
    ).toBe(0);
  });

  // "Deep work — 2 h a day in 25 min blocks" from screen 3e.
  test("durationPerDay converts remaining minutes into whole sessions", () => {
    const a = activity({
      id: "deep-work",
      sessionMinutes: 25,
      minimum: { type: "durationPerDay", value: 120 },
    });
    expect(sessionsNeededToday(a, NO_PROGRESS, monday)).toBe(5);
    expect(
      sessionsNeededToday(
        a,
        { ...NO_PROGRESS, completedMinutesToday: 50 },
        monday,
      ),
    ).toBe(3);
  });

  test("countPerWeek spreads across the eligible days left", () => {
    const a = activity({
      id: "walk",
      minimum: { type: "countPerWeek", value: 3 },
    });
    // Thursday, 3 still owed, 3 eligible days left (Thu/Fri/Sat) -> 1 today.
    expect(sessionsNeededToday(a, NO_PROGRESS, 4)).toBe(1);
    // Saturday, 3 still owed, 1 day left -> all 3 today.
    expect(sessionsNeededToday(a, NO_PROGRESS, 6)).toBe(3);
    expect(
      sessionsNeededToday(a, { ...NO_PROGRESS, completedThisWeek: 3 }, 4),
    ).toBe(0);
  });

  test("paused activities and off-days need nothing", () => {
    expect(
      sessionsNeededToday(
        activity({ id: "a", isActive: false }),
        NO_PROGRESS,
        1,
      ),
    ).toBe(0);
    const weekdaysOnly = activity({ id: "a", daysOfWeek: 0b0111110 });
    expect(sessionsNeededToday(weekdaysOnly, NO_PROGRESS, 0)).toBe(0); // Sunday
    expect(sessionsNeededToday(weekdaysOnly, NO_PROGRESS, 1)).toBe(1); // Monday
  });
});

/* ── The solver ──────────────────────────────────────────────────────────── */

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  dayStart: at(9),
  dayEnd: at(17),
  busy: [],
  locked: [],
  demands: [],
  ...over,
});

describe("plan", () => {
  test("places a session in the only gap", () => {
    const result = plan(
      input({
        busy: toBusyBlocks([event({ id: "m", start: at(9), end: at(16, 50) })]),
        demands: [demand(activity({ id: "stretch" }))],
      }),
    );
    expect(result.placed).toHaveLength(1);
    expect(asLocal(result.placed[0]?.start ?? 0)).toBe("16:50");
    expect(result.unplaced).toEqual([]);
  });

  test("honours preferred windows", () => {
    const result = plan(
      input({
        demands: [
          demand(activity({ id: "lunch-walk" }), 1, [
            preferredInstant(DATE, ZONE, 13 * 60),
          ]),
        ],
      }),
    );
    expect(asLocal(result.placed[0]?.start ?? 0)).toBe("13:00");
  });

  test("falls back to the nearest available time when the preferred slot is busy", () => {
    const result = plan(
      input({
        busy: toBusyBlocks([
          event({ id: "m", start: at(12, 30), end: at(14) }),
        ]),
        demands: [
          demand(activity({ id: "walk" }), 1, [
            preferredInstant(DATE, ZONE, 13 * 60),
          ]),
        ],
      }),
    );
    // 14:00 is 60 min from preferred; 12:20 is only 40, so it wins.
    expect(asLocal(result.placed[0]?.start ?? 0)).toBe("12:20");
  });

  // 3e: "Never before a meeting · leaves 5 min".
  test("leaves the pre-meeting buffer clear", () => {
    // Preferring the latest possible time pushes the session hard against the
    // meeting, so the buffer is the only thing that can stop it.
    const runWith = (bufferBeforeMeetingMinutes: number) =>
      plan(
        input({
          busy: toBusyBlocks([
            event({ id: "m", start: at(9, 20), end: at(17) }),
          ]),
          demands: [
            demand(activity({ id: "stretch", bufferBeforeMeetingMinutes }), 1, [
              at(9, 20),
            ]),
          ],
        }),
      );

    expect(asLocal(runWith(5).placed[0]?.end ?? 0)).toBe("09:15");
    // Without a buffer it would happily run right up to the meeting.
    expect(asLocal(runWith(0).placed[0]?.end ?? 0)).toBe("09:20");
  });

  test("reports buffer_blocked separately from no_gap", () => {
    const tightGap = toBusyBlocks([
      event({ id: "m", start: at(9, 12), end: at(17) }),
    ]);

    const blocked = plan(
      input({
        busy: tightGap,
        demands: [
          demand(activity({ id: "stretch", bufferBeforeMeetingMinutes: 5 })),
        ],
      }),
    );
    expect(blocked.unplaced).toEqual([
      { activityId: "stretch", sessions: 1, reason: "buffer_blocked" },
    ]);

    const noRoom = plan(
      input({
        busy: toBusyBlocks([event({ id: "m", start: at(9), end: at(17) })]),
        demands: [demand(activity({ id: "stretch" }))],
      }),
    );
    expect(noRoom.unplaced).toEqual([
      { activityId: "stretch", sessions: 1, reason: "no_gap" },
    ]);
  });

  test("never moves a locked slot, and treats it as busy", () => {
    const locked = {
      activityId: "pinned",
      start: at(9),
      end: at(16, 50),
      isLocked: true,
    };
    const result = plan(
      input({
        locked: [locked],
        demands: [demand(activity({ id: "stretch" }))],
      }),
    );
    expect(result.placed).toContainEqual(locked);
    expect(asLocal(result.placed[1]?.start ?? 0)).toBe("16:50");
  });

  // 3e: importance "wins the gap when two activities compete".
  test("importance decides who gets the only gap", () => {
    const result = plan(
      input({
        busy: toBusyBlocks([event({ id: "m", start: at(9, 10), end: at(17) })]),
        demands: [
          demand(activity({ id: "a-low", importance: "low" })),
          demand(activity({ id: "z-high", importance: "high" })),
        ],
      }),
    );
    expect(result.placed.map((p) => p.activityId)).toEqual(["z-high"]);
    expect(result.unplaced).toEqual([
      { activityId: "a-low", sessions: 1, reason: "no_gap" },
    ]);
  });

  test("places every session of a multi-session demand", () => {
    const result = plan(
      input({
        demands: [demand(activity({ id: "eye-rest", sessionMinutes: 5 }), 4)],
      }),
    );
    expect(result.placed).toHaveLength(4);
    expect(new Set(result.placed.map((p) => p.start)).size).toBe(4);
  });

  test("is deterministic — the same input yields the same plan", () => {
    const build = () =>
      input({
        busy: toBusyBlocks([
          event({ id: "m1", start: at(10), end: at(11) }),
          event({ id: "m2", start: at(13), end: at(14) }),
        ]),
        demands: [
          demand(activity({ id: "b-stretch" }), 2),
          demand(activity({ id: "a-eyes", sessionMinutes: 5 }), 3),
        ],
      });
    expect(plan(build())).toEqual(plan(build()));
  });
});

/* ── The wall-clock boundary, where DST bugs live ────────────────────────── */

describe("localtime", () => {
  test("the same wall-clock time has different offsets across DST", () => {
    const winter = instantFromLocal(
      { year: 2026, month: 1, day: 15, hour: 9, minute: 0 },
      ZONE,
    ).instant;
    const summer = instantFromLocal(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      ZONE,
    ).instant;

    expect(zoneOffsetMs(winter, ZONE)).toBe(60 * 60_000); // CET
    expect(zoneOffsetMs(summer, ZONE)).toBe(2 * 60 * 60_000); // CEST

    // 09:00 local is a *different* UTC instant in each — which is exactly why
    // a recurring slot must be stored as local time plus zone, never as a
    // fixed UTC instant.
    expect(new Date(winter).getUTCHours()).toBe(8);
    expect(new Date(summer).getUTCHours()).toBe(7);
  });

  test("a nonexistent local time shifts forward", () => {
    // Europe/Rome springs forward 2026-03-29: 02:00 -> 03:00. 02:30 never happens.
    const resolved = instantFromLocal(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      ZONE,
    );
    expect(resolved.shifted).toBe(true);
    expect(asLocal(resolved.instant)).toBe("03:30");
  });

  test("an ordinary local time is not flagged as shifted", () => {
    expect(
      instantFromLocal({ ...DATE, hour: 9, minute: 0 }, ZONE).shifted,
    ).toBe(false);
  });

  test("a spring-forward day is one hour shorter in real time", () => {
    const normal = dayBounds(
      { year: 2026, month: 3, day: 22 },
      ZONE,
      0,
      23 * 60,
    );
    const springForward = dayBounds(
      { year: 2026, month: 3, day: 29 },
      ZONE,
      0,
      23 * 60,
    );
    expect(
      normal.end - normal.start - (springForward.end - springForward.start),
    ).toBe(60 * 60_000);
  });

  test("weekday is read in the user's zone, not UTC", () => {
    // 23:30 local on Monday in Rome is still 21:30 UTC Monday...
    expect(localWeekday(at(23, 30), ZONE)).toBe(1);
    // ...but 00:30 local Tuesday is 22:30 UTC *Monday*, and must read as Tuesday.
    const tuesday = instantFromLocal(
      { year: 2026, month: 8, day: 25, hour: 0, minute: 30 },
      ZONE,
    ).instant;
    expect(new Date(tuesday).getUTCDay()).toBe(1);
    expect(localWeekday(tuesday, ZONE)).toBe(2);
  });

  test("a user who travels keeps their preferred wall-clock time", () => {
    const rome = preferredInstant(DATE, ZONE, 7 * 60);
    const tokyo = preferredInstant(DATE, "Asia/Tokyo", 7 * 60);
    expect(asLocal(rome)).toBe("07:00");
    expect(rome).not.toBe(tokyo);
    expect((rome - tokyo) / 3_600_000).toBe(7); // Rome is 7h behind Tokyo in August
  });
});
