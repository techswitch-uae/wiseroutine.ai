/**
 * The frame of a calendar: the four scopes, and the dates each one covers.
 *
 * Separate from the components that draw them, and local-time throughout,
 * deliberately: this is the scaffold, not the plan. A slot carries its own
 * instants and is converted against the account's zone where it is drawn.
 *
 * ponytail: local `Date`. Take the account time zone here once a view
 * actually renders server data.
 */

const DAY_MS = 86_400_000;

export type Scope = "day" | "week" | "month" | "year";

export const SCOPES: readonly { key: Scope; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
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

export const addDays = (at: Date, days: number): Date =>
  midnightOf(new Date(at.getTime() + days * DAY_MS));

export interface WeekBlock {
  key: string;
  /** Minutes from local midnight. */
  startMinutes: number;
  endMinutes: number;
  title: string;
  /** `meeting` sits back, `slot` comes forward, `live` is the one in hand,
   *  `free` is room the planner found and is holding open. */
  variant: "slot" | "meeting" | "live" | "free";
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
  taken?: number;
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

export interface YearMonth {
  /** 0-11, so it can be handed straight back to `Date`. */
  month: number;
  label: string;
  state: "past" | "current" | "future";
  /** Share of daily minimums met. Omitted for a month that has not run. */
  percent?: number;
  /** One entry per week: 0-1 met, or null for a week with nothing in it. */
  weeks?: readonly (number | null)[];
  /** Which week is the current one, for the "Now" marker. */
  nowWeek?: number;
  note?: string;
}

/** Twelve months of a year, empty. */
export const yearMonthsOf = (year: number, today: Date): YearMonth[] =>
  Array.from({ length: 12 }, (_, month) => ({
    month,
    label: new Intl.DateTimeFormat("en-GB", { month: "long" }).format(
      new Date(year, month, 1),
    ),
    state:
      year < today.getFullYear() ||
      (year === today.getFullYear() && month < today.getMonth())
        ? ("past" as const)
        : year === today.getFullYear() && month === today.getMonth()
          ? ("current" as const)
          : ("future" as const),
  }));
