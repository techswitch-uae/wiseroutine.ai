/**
 * `GET /scope` turned into what the week and month grids draw.
 *
 * Here rather than in either route because both scopes read the same answer
 * and only differ in what they take from it, and because this is the one part
 * of the calendar with logic worth testing: clamping a meeting to the visible
 * hours, splitting one that runs past midnight, and deciding what to do with
 * the entries the window hides.
 *
 * The server has already bucketed by local day and sent each day's own
 * midnight, so nothing here builds a `Date` or knows the account's zone. A
 * position is a subtraction.
 */

import {
  clockOf,
  type MonthCell,
  type WeekAllDay,
  type WeekBlock,
  type WeekBlockDetail,
  type WeekDay,
} from "@wiseroutine/design";
import type { ScopeDay, ScopeResponse, ScopeSlot } from "./api";

const MINUTE_MS = 60_000;

/** What the account has on screen, minutes from midnight. */
export interface HoursWindow {
  startMinutes: number;
  endMinutes: number;
}

/** An instant as minutes from that day's own midnight. */
const minutesInto = (at: number, day: ScopeDay): number =>
  Math.round((at - day.dayStart) / MINUTE_MS);

/** Titles are optional by design - an account can keep busy intervals and no
 *  names at all - so every caller needs the same fallback. */
const named = (title: string | null): string => title ?? "Busy";

/** The days of the answer, by the iso the grid addresses them with. */
const byIso = (data: ScopeResponse | null): Map<string, ScopeDay> =>
  new Map((data?.days ?? []).map((day) => [day.iso, day]));

/**
 * One entry as a block, clamped to the window - or null if the window misses
 * it entirely.
 *
 * The clamp is not cosmetic. `WeekGrid` positions a block by subtracting the
 * window's start, and the track sets no overflow, so a 06:00 meeting against
 * an 08:00 window does not disappear: it draws two hours above the track, on
 * top of the all-day strip.
 */
const blockIn = (
  window: HoursWindow,
  day: ScopeDay,
  entry: { id: string; startsAt: number; endsAt: number },
  title: string,
  variant: WeekBlock["variant"],
  detail?: WeekBlockDetail,
): WeekBlock | null => {
  const from = Math.max(minutesInto(entry.startsAt, day), window.startMinutes);
  const to = Math.min(minutesInto(entry.endsAt, day), window.endMinutes);
  // Half-open: something ending exactly as the window opens is above it, not
  // inside it as a block of no height.
  if (to <= from) return null;

  return {
    key: `${day.iso}-${entry.id}`,
    startMinutes: from,
    endMinutes: to,
    title,
    variant,
    ...(detail ? { detail } : {}),
  };
};

/** How a slot reads when it is pressed: "09:00–09:25". Written from the
 *  block's own clamped minutes, so a slot the window cuts short says the hours
 *  it actually runs rather than the ones on screen. */
const whenOf = (day: ScopeDay, from: number, to: number): string =>
  `${clockOf(minutesInto(from, day))}–${clockOf(minutesInto(to, day))}`;

/**
 * Where the slot has got to: "Planned", "Started", "Completed".
 *
 * The status and nothing else. The slot also carries a `kind` - recovery,
 * focus, task - and the popover used to lead with it, which promised a
 * categorisation the app does not have yet: nothing anywhere else lets someone
 * set it or filter by it, so naming it here was the UI inventing a feature.
 */
const noteOf = (slot: ScopeSlot): string =>
  slot.status.charAt(0).toUpperCase() + slot.status.slice(1);

/** "2 earlier", "1 later", "2 earlier · 1 later" - what the hours hide. */
const hiddenNote = (before: number, after: number): string | undefined => {
  const parts = [
    ...(before > 0 ? [`${before} earlier`] : []),
    ...(after > 0 ? [`${after} later`] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : undefined;
};

/**
 * Fill the week scaffold with what the server answered.
 *
 * Takes the empty columns rather than building them: `weekDaysOf` already
 * decides which day is today and which are past, and those are facts about the
 * calendar, not about the data - the week has to draw them before any answer
 * arrives, and must not redraw them differently once one does.
 */
export function weekDaysFrom(
  days: readonly WeekDay[],
  data: ScopeResponse | null,
  window: HoursWindow,
): WeekDay[] {
  const found = byIso(data);

  return days.map((column) => {
    const day = found.get(column.iso);
    if (!day) return column;

    const allDay: WeekAllDay[] = day.meetings
      .filter((meeting) => meeting.isAllDay)
      .map((meeting) => ({
        key: `${day.iso}-${meeting.id}`,
        title: named(meeting.title),
      }));

    /**
     * Meetings first, slots second.
     *
     * Every block is absolutely positioned, so paint order is DOM order, and
     * the week's whole premise is that meetings sit back while your own slots
     * come forward. Sorting these together by time would put that the wrong
     * way round for any slot the planner placed inside a meeting - which is
     * precisely the case worth being able to see.
     */
    const timed = day.meetings.filter((meeting) => !meeting.isAllDay);
    const placed = [
      ...timed.map((entry) => ({
        entry,
        block: blockIn(window, day, entry, named(entry.title), "meeting"),
      })),
      ...day.slots.map((entry) => ({
        entry,
        block: blockIn(
          window,
          day,
          entry,
          entry.title,
          entry.status === "live" || entry.status === "started"
            ? "live"
            : "slot",
          // Only slots get details. A meeting is something the week reports
          // and knows nothing more about - a popover on one would open to say
          // the title over again.
          {
            when: whenOf(day, entry.startsAt, entry.endsAt),
            note: noteOf(entry),
          },
        ),
      })),
    ];

    // Counted from what the clamp dropped rather than from a second pass over
    // the times: one rule decides what is visible, and the note reports it.
    const hidden = placed
      .filter((it) => it.block === null)
      .map((it) => it.entry);
    const before = hidden.filter(
      (entry) => minutesInto(entry.endsAt, day) <= window.startMinutes,
    ).length;
    const note = hiddenNote(before, hidden.length - before);

    return {
      ...column,
      ...(allDay.length > 0 ? { allDay } : {}),
      blocks: placed
        .map((it) => it.block)
        .filter((block): block is WeekBlock => block !== null),
      ...(note ? { note } : {}),
    };
  });
}

/**
 * Fill the month scaffold: dots for slots, a count for meetings.
 *
 * Meetings get the note rather than a third dot. A month cell is 78px tall and
 * already carries two kinds of dot; a third would make the row of them a thing
 * to decode rather than glance at, and "4 mtgs" is the question anyone asks of
 * a month anyway - how booked was it, not which meetings.
 */
export function monthCellsFrom(
  cells: readonly MonthCell[],
  data: ScopeResponse | null,
): MonthCell[] {
  const found = byIso(data);

  return cells.map((cell) => {
    const day = found.get(cell.iso);
    if (!day) return cell;

    const done = day.slots.filter((slot) => slot.status === "completed").length;
    // Everything still ahead of itself. Skipped and missed are neither done
    // nor planned - a hollow dot for a slot that will never happen would be a
    // promise the day already broke.
    const planned = day.slots.filter(
      (slot) =>
        slot.status === "planned" ||
        slot.status === "live" ||
        slot.status === "started",
    ).length;
    const meetings = day.meetings.length;

    return {
      ...cell,
      ...(done > 0 ? { done } : {}),
      ...(planned > 0 ? { planned } : {}),
      ...(meetings > 0
        ? { note: `${meetings} mtg${meetings === 1 ? "" : "s"}` }
        : {}),
    };
  });
}
