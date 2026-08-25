import type { Instant, Minutes } from "./types";

/**
 * The wall-clock boundary.
 *
 * The solver works only in instants, so every "07:00 local" must become an
 * instant before it reaches `plan()`. That conversion is where DST bugs live,
 * so it lives here, alone, and is tested directly.
 *
 * Uses `Intl` only — available in Workers, browsers and the Tauri renderer, so
 * this package still has zero dependencies.
 */

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface LocalTime extends LocalDate {
  hour: number;
  minute: number;
}

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function readParts(
  instant: Instant,
  timeZone: string,
): Required<LocalTime> & { second: number } {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's UTC offset, in milliseconds, *at a given instant*. Offsets are a
 *  function of (zone, instant) — which is exactly why we never store one. */
export function zoneOffsetMs(instant: Instant, timeZone: string): number {
  const p = readParts(instant, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
  );
}

export interface ResolvedLocal {
  instant: Instant;
  /**
   * True when the requested wall-clock time does not exist in this zone — the
   * hour skipped by a spring-forward transition. The instant returned is the
   * shifted-forward equivalent.
   *
   * The policy is explicit rather than left to a date library: a nonexistent
   * local time moves forward. A slot at 02:30 on that night runs at 03:30.
   */
  shifted: boolean;
}

/** Convert a local wall-clock time in `timeZone` to an instant. */
export function instantFromLocal(
  local: LocalTime,
  timeZone: string,
): ResolvedLocal {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );

  // Two passes: the first offset is read at the wrong instant near a
  // transition, the second corrects it. A third pass never changes the answer.
  let instant = naive - zoneOffsetMs(naive, timeZone);
  instant = naive - zoneOffsetMs(instant, timeZone);

  const actual = readParts(instant, timeZone);
  const shifted = actual.hour !== local.hour || actual.minute !== local.minute;

  return { instant, shifted };
}

/** Day 0-6, Sunday-first, as seen in `timeZone`. Matches `Activity.daysOfWeek`. */
export function localWeekday(instant: Instant, timeZone: string): number {
  const p = readParts(instant, timeZone);
  // Date.UTC on the local wall-clock fields gives a Date whose UTC weekday is
  // the local weekday, with no offset arithmetic to get wrong.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** The local calendar date at an instant. */
export function localDateOf(instant: Instant, timeZone: string): LocalDate {
  const { year, month, day } = readParts(instant, timeZone);
  return { year, month, day };
}

/**
 * The planning window for one local day.
 *
 * `startMinutes`/`endMinutes` are minutes from local midnight (so 08:00 is 480).
 * Because both ends are resolved independently against the zone, a day that
 * gains or loses an hour to DST produces a window that is correspondingly
 * longer or shorter in real time — which is the correct behaviour.
 */
export function dayBounds(
  date: LocalDate,
  timeZone: string,
  startMinutes: Minutes,
  endMinutes: Minutes,
): { start: Instant; end: Instant } {
  const at = (minutes: Minutes): Instant =>
    instantFromLocal(
      { ...date, hour: Math.floor(minutes / 60), minute: minutes % 60 },
      timeZone,
    ).instant;

  return { start: at(startMinutes), end: at(endMinutes) };
}

/** A preferred window ("07:00") resolved against a local date. */
export function preferredInstant(
  date: LocalDate,
  timeZone: string,
  minutesFromMidnight: Minutes,
): Instant {
  return instantFromLocal(
    {
      ...date,
      hour: Math.floor(minutesFromMidnight / 60),
      minute: minutesFromMidnight % 60,
    },
    timeZone,
  ).instant;
}
