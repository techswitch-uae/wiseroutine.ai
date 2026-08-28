/**
 * Which hours the day view covers.
 *
 * Three ranges at most: the working hours the planner already places into, the
 * full 24, and one the user has named. They are derived here rather than
 * stored as rows because two of the three are not data - they are the working
 * window read a second way, and a constant. A `day_ranges` table would let
 * "working hours" drift from `day_start_minutes`, which is the one thing that
 * must not happen: the planner and the view have to agree about the same
 * window or a slot appears outside the day it was placed in.
 */

export const FULL_DAY_MINUTES = 24 * 60;

export type DayRangeKey = "working" | "full" | "custom";

export interface DayRange {
  key: DayRangeKey;
  /** What the picker shows. The custom one is the user's own words. */
  label: string;
  startMinutes: number;
  endMinutes: number;
}

/** Just the settings this file reads, so callers with a richer user - the
 *  request context, a test fixture - satisfy it without being it. */
export interface DayRangeSettings {
  dayStartMinutes: number;
  dayEndMinutes: number;
  customRangeLabel: string | null;
  customRangeStartMinutes: number | null;
  customRangeEndMinutes: number | null;
  dayOpensOn: string;
}

/**
 * The ranges this user can choose between, in the order the picker shows them.
 *
 * The custom one is absent until all three of its columns are set. A label
 * with no hours is not something anyone can select, and offering it would put
 * a row in the picker that cannot be honoured.
 */
export function dayRanges(user: DayRangeSettings): DayRange[] {
  const ranges: DayRange[] = [
    {
      key: "working",
      label: "Working hours",
      startMinutes: user.dayStartMinutes,
      endMinutes: user.dayEndMinutes,
    },
    {
      key: "full",
      label: "Full day",
      startMinutes: 0,
      endMinutes: FULL_DAY_MINUTES,
    },
  ];

  if (
    user.customRangeLabel !== null &&
    user.customRangeStartMinutes !== null &&
    user.customRangeEndMinutes !== null
  ) {
    ranges.push({
      key: "custom",
      label: user.customRangeLabel,
      startMinutes: user.customRangeStartMinutes,
      endMinutes: user.customRangeEndMinutes,
    });
  }

  return ranges;
}

/**
 * The range to show: what was asked for, else what the day opens on, else the
 * working hours.
 *
 * Both fallbacks are load-bearing. `dayOpensOn` can name a custom range that
 * has since been deleted, and a client can ask for one that was deleted while
 * its window was open - neither is an error worth failing a page load over,
 * and both would otherwise leave someone looking at an empty day with no way
 * to tell why.
 */
export function resolveRange(
  user: DayRangeSettings,
  requested?: string | null,
): DayRange {
  const available = dayRanges(user);
  const pick = (key: string | null | undefined) =>
    available.find((range) => range.key === key);

  // The working hours by key rather than by position: `dayRanges` always
  // includes them, and naming the fallback means reordering the picker cannot
  // quietly change what a stale setting falls back to.
  return (
    pick(requested) ??
    pick(user.dayOpensOn) ?? {
      key: "working",
      label: "Working hours",
      startMinutes: user.dayStartMinutes,
      endMinutes: user.dayEndMinutes,
    }
  );
}
