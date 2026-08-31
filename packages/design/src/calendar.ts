/**
 * The frame of a calendar: the three scopes, and the dates each one covers.
 *
 * Separate from the components that draw them, and local-time throughout,
 * deliberately: this is the scaffold, not the plan. A slot carries its own
 * instants and is converted against the account's zone where it is drawn.
 *
 * The scaffold stays on the browser's own zone even now that the week and
 * month draw server data, and that is deliberate: the server buckets by the
 * account's zone and answers with the same `YYYY-MM-DD` keys these functions
 * produce, so the two meet on the iso and neither has to know the other's
 * clock.
 *
 * ponytail: which day is "today" is still the device's opinion. It only shows
 * for someone whose device is in a different zone from their account, and it
 * shows the same way on the day view - so this belongs to whatever fixes that,
 * not to the week.
 */

export type Scope = "day" | "week" | "month";

export const SCOPES: readonly { key: Scope; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/** `YYYY-MM-DD` in local time - the identity a day is addressed by. */
export const isoOf = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(
    at.getDate(),
  ).padStart(2, "0")}`;

/** Local midnight, so day arithmetic never lands mid-afternoon. */
export const midnightOf = (at: Date): Date =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** Monday, because that is how the grid is read - see `WEEK_ORDER`. */
export const weekStartOf = (at: Date): Date => {
  const start = midnightOf(at);
  // getDay() is Sunday-first; Sunday belongs to the week that began six days
  // earlier, not the one starting tomorrow.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};

/**
 * The same time of day, N days on. Calendar arithmetic, not milliseconds.
 *
 * `at.getTime() + days * DAY_MS` is the obvious version and it is wrong twice
 * a year: the day the clocks go back is 25 hours long, so adding 24 of them to
 * its midnight lands at 23:00 the same evening, and snapping that to midnight
 * gives back the day it started from. The month grid drew 26 October 2025
 * twice and pulled every day after it back by one - a month of slots hung on
 * the wrong dates, in every country that changes its clocks.
 *
 * `setDate` counts days rather than elapsed time, which is what a calendar
 * means by "tomorrow", and rolls over months and years on its own.
 */
export const addDays = (at: Date, days: number): Date => {
  const out = midnightOf(at);
  out.setDate(out.getDate() + days);
  return out;
};

/**
 * What a block says when it is pressed.
 *
 * The title is the block's own, unabbreviated: two overlapping blocks each get
 * half a column, and half of 140px is not enough for "Deep work - draft the
 * migration". The column layout is what makes a clash visible; this is what
 * makes it readable.
 */
export interface WeekBlockDetail {
  /** "09:00-09:25". The screen formats it - the grid never sees a zone. */
  when: string;
  /** "Started". Whatever the block's own label had no room for. */
  note?: string;
}

export interface WeekBlock {
  key: string;
  /** Minutes from local midnight. */
  startMinutes: number;
  endMinutes: number;
  title: string;
  /** `meeting` sits back, `slot` comes forward, `live` is the one in hand,
   *  `free` is room the planner found and is holding open. */
  variant: "slot" | "meeting" | "live" | "free";
  /**
   * Details, and with them a press that opens them.
   *
   * Only your own slots carry this. A meeting from a connected calendar is
   * something the week reports, not something it knows anything more about -
   * a popover on one would open to say the title again.
   */
  detail?: WeekBlockDetail;
}

/** An entry with no hour to sit on - an all-day meeting, a day off. */
export interface WeekAllDay {
  key: string;
  title: string;
}

export interface WeekDay {
  iso: string;
  /** "Mon 10". The screen writes it; the grid does not format dates. */
  label: string;
  note?: string;
  today?: boolean;
  /** Before today: read-only, and drawn back. */
  past?: boolean;
  blocks?: readonly WeekBlock[];
  /**
   * All-day entries, drawn in the strip above the grid rather than in it.
   *
   * They cannot be placed on an hour line - one drawn as a block would span
   * the whole column and hide the day behind it, which is exactly why the day
   * timeline has never shown them at all.
   */
  allDay?: readonly WeekAllDay[];
}

/** The seven columns of a week, empty. Contents are filled in by the screen. */
export const weekDaysOf = (start: Date, today: Date): WeekDay[] => {
  const todayIso = isoOf(today);
  return Array.from({ length: 7 }, (_, index) => {
    const at = addDays(start, index);
    const iso = isoOf(at);
    const label = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
    }).format(at);
    return {
      iso,
      label: iso === todayIso ? `${label} · today` : label,
      ...(iso === todayIso ? { today: true } : {}),
      ...(iso < todayIso ? { past: true } : {}),
    };
  });
};

export interface MonthCell {
  iso: string;
  day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
  today?: boolean;
  past?: boolean;
  note?: string;
  /** Minimums met, and minimums still to come. One dot each. */
  done?: number;
  planned?: number;
}

/** Six Monday-first rows covering the month, neighbours included. */
export const monthCellsOf = (
  year: number,
  month: number,
  today: Date,
): MonthCell[] => {
  const todayIso = isoOf(today);
  const start = weekStartOf(new Date(year, month, 1));
  return Array.from({ length: 42 }, (_, index) => {
    const at = addDays(start, index);
    const iso = isoOf(at);
    return {
      iso,
      day: at.getDate(),
      inMonth: at.getMonth() === month,
      ...(iso === todayIso ? { today: true } : {}),
      ...(iso < todayIso ? { past: true } : {}),
    };
  });
};
