import {
  deviceTimeZone,
  openGaps,
  type ScopeDay,
  type TodayResponse,
} from "./api";
import { snappedNow } from "./todos";

/**
 * What Quick add computes, kept apart from what it draws.
 *
 * Beside `owed.ts` and `todos.ts` for the same reason those are here: the
 * answers are facts about the day, testable without a dialog around them.
 */

export interface Suggestion {
  key: string;
  /** The left column: a clock, a weekday, a dash. */
  when: string;
  title: string;
  note: string;
  /** Where it would land, or null for a row that opens something instead. */
  at: number | null;
  action: "place" | "time" | { addonId: string; key: string };
  dashed?: boolean;
}

/** The lengths on offer. Four around the default, so the pills stay a row. */
const LADDER = [5, 10, 15, 20, 25, 30, 45, 60, 90];

export function durationsFor(minutes: number): number[] {
  const ladder = LADDER.includes(minutes)
    ? LADDER
    : [...LADDER, minutes].sort((a, b) => a - b);
  const idx = ladder.indexOf(minutes);
  const start = Math.max(0, Math.min(idx - 1, ladder.length - 4));
  return ladder.slice(start, start + 4);
}

export const clockIn = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(at);

export const weekdayIn = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(at);

/** Every gap on a day that takes `minutes`, started on the grid. */
function gapsFor(
  day: Parameters<typeof openGaps>[0],
  from: number,
  minutes: number,
): { startsAt: number; free: number }[] {
  return openGaps(day, snappedNow(from), minutes)
    .map((g) => ({
      startsAt: snappedNow(g.startsAt),
      free: Math.floor((g.endsAt - snappedNow(g.startsAt)) / 60_000),
    }))
    .filter((g) => g.free >= minutes);
}

/**
 * Where something this long could go, best first.
 *
 * Today's next gap and the one after it, then the first gap tomorrow. Never
 * more than three: a list of every gap is the timeline, and the timeline is
 * behind the dialog already.
 */
export function suggestionsFor(
  minutes: number,
  today: TodayResponse | null,
  tomorrow: ScopeDay | null,
  now: number,
): Suggestion[] {
  const out: Suggestion[] = [];
  const tz = today?.timeZone ?? deviceTimeZone();

  const [first, second] = today ? gapsFor(today, now, minutes) : [];
  if (first) {
    out.push({
      key: "first",
      when: clockIn(first.startsAt, tz),
      title:
        first.startsAt === snappedNow(now) ? "Now, on the grid" : "Next gap",
      note: `${first.free} min free`,
      at: first.startsAt,
      action: "place",
    });
  }
  if (second) {
    out.push({
      key: "second",
      when: clockIn(second.startsAt, tz),
      title: "Later today",
      note: `${second.free} min free`,
      at: second.startsAt,
      action: "place",
    });
  }
  // `/scope` bounds a day at midnight; the hours worth offering are the ones
  // today is drawn against, so tomorrow is narrowed to the same range.
  const range = today?.ranges.find((r) => r.key === today.range);
  const [morning] =
    tomorrow && range
      ? gapsFor(
          {
            ...tomorrow,
            dayStart: tomorrow.dayStart + range.startMinutes * 60_000,
            dayEnd: tomorrow.dayStart + range.endMinutes * 60_000,
          },
          tomorrow.dayStart + range.startMinutes * 60_000,
          minutes,
        )
      : tomorrow
        ? gapsFor(tomorrow, tomorrow.dayStart, minutes)
        : [];
  if (morning) {
    out.push({
      key: "tomorrow",
      when: weekdayIn(morning.startsAt, tz),
      title: `Tomorrow, ${clockIn(morning.startsAt, tz)}`,
      note: "First gap of the day",
      at: morning.startsAt,
      action: "place",
    });
  }
  return out;
}
