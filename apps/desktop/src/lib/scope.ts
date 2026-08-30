import {
  addDays,
  isoOf,
  midnightOf,
  type Scope,
  weekStartOf,
} from "@wiseroutine/design";

/**
 * Which period the calendar is looking at, and how it is written.
 *
 * The period lives in the URL rather than in a component, for two reasons.
 * The sidebar names it - the active scope carries the period on its own row -
 * and the sidebar is mounted by the shell, not by the page, so a value held
 * on the page could not reach it without a store. And a week paged forward
 * then reloaded should still be that week, which local state cannot promise.
 *
 * Absent means today's period. Nothing writes "this week" into the URL: the
 * default is the answer, and a link with no parameters is a link to now.
 */

/** `YYYY-MM-DD` back to a local midnight, or the fallback if it is not one. */
export const dayOf = (value: string | undefined, fallback: Date): Date => {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return fallback;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // A parsed 2026-02-31 rolls into March rather than failing, and would then
  // disagree with the string it came from. Round-tripping is the check.
  return isoOf(at) === value ? at : fallback;
};

/** `YYYY-MM` back to the first of that month. */
export const monthOf = (
  value: string | undefined,
  fallback: Date,
): { year: number; month: number } => {
  const match = value && /^(\d{4})-(\d{2})$/.exec(value);
  const month = match ? Number(match[2]) - 1 : -1;
  if (!match || month < 0 || month > 11)
    return { year: fallback.getFullYear(), month: fallback.getMonth() };
  return { year: Number(match[1]), month };
};

export const yearOf = (value: string | undefined, fallback: Date): number => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1970 && year <= 9999
    ? year
    : fallback.getFullYear();
};

/** `YYYY-MM` for a search parameter. */
export const monthKey = (year: number, month: number): string =>
  `${year}-${String(month + 1).padStart(2, "0")}`;

const fmt = (at: Date, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat("en-GB", options).format(at);

/**
 * "10–16 August", or "28 July – 3 August" when the week straddles two.
 *
 * The month is written once when it can be: a week is one object, and naming
 * its month twice makes it read as two halves.
 */
export const weekLabel = (start: Date, short = false): string => {
  const end = addDays(start, 6);
  const month = short ? "short" : "long";
  if (start.getMonth() === end.getMonth())
    return `${start.getDate()}–${fmt(end, { day: "numeric", month })}`;
  return `${fmt(start, { day: "numeric", month })} – ${fmt(end, { day: "numeric", month })}`;
};

export const monthLabel = (
  year: number,
  month: number,
  short = false,
): string =>
  short
    ? fmt(new Date(year, month, 1), { month: "long" })
    : fmt(new Date(year, month, 1), { month: "long", year: "numeric" });

/** The date on the switcher's Day row - see rule 1: Day is always today. */
export const dayLabel = (today: Date): string =>
  fmt(today, { day: "numeric", month: "short" });

/**
 * The period on screen, written for the sidebar, from the URL alone.
 *
 * The shell owns the switcher and has no page state to read, so this is what
 * it gets: a path, whatever search parameters came with it, and today.
 */
/**
 * Which scope of the calendar this path is, or none of them.
 *
 * `null` matters as much as the four names. This used to fall back to "day"
 * for anything it did not recognise, so Activities, Calendars and Settings all
 * left Day lit in the rail - two things looking current at once, which makes
 * the highlight mean nothing. Only the day's own route is the day.
 */
export const scopeOf = (pathname: string): Scope | null =>
  pathname === "/"
    ? "day"
    : pathname === "/week"
      ? "week"
      : pathname === "/month"
        ? "month"
        : pathname === "/year"
          ? "year"
          : null;

export const periodLabel = (
  scope: Scope | null,
  search: Record<string, unknown>,
  today: Date,
): string | undefined => {
  const str = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;

  // The day it is showing, not the day it links to. `dayLabel` supplies the
  // latter on the Day row whenever another scope is current, so the entry
  // reads as "go to today" from elsewhere and as "you are here, on this day"
  // once you are on it.
  if (scope === "day") return dayLabel(dayOf(str("date"), today));
  if (scope === "week")
    return weekLabel(weekStartOf(dayOf(str("start"), today)), true);
  if (scope === "month") {
    const { year, month } = monthOf(str("m"), today);
    return monthLabel(year, month, true);
  }
  if (scope === "year") return String(yearOf(str("y"), today));
  return undefined;
};

/** Today at local midnight. One call site, so every view agrees on "now". */
export const todayOf = (): Date => midnightOf(new Date());
