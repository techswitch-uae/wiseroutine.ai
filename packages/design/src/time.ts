/**
 * Minutes from local midnight, which is how every window is stored.
 *
 * The pair below is the only place the two representations meet. Wall-clock
 * strings never travel further than the input they came from: a window stored
 * as text would have to be parsed against a zone at every use, and the whole
 * point of minutes-from-midnight is that it follows the user across one.
 */
export const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;

/** "08:30" back to 510. NaN-free: an empty or half-typed field answers null
 *  rather than a number that would be stored as a real time. */
export const minutesOf = (clock: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * Which days an activity runs on, as the seven-bit mask the schema stores.
 *
 * Sunday is bit 0, which is `Date.getDay()`'s own numbering and the
 * scheduler's - so the mask can be tested against a weekday without anyone
 * having to remember a second convention.
 */
export const EVERY_DAY = 0b1111111;
export const WEEKDAYS = 0b0111110;
export const WEEKENDS = 0b1000001;

/** Sunday first, to match the bit order. */
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The order a week is read in, which is not the order it is stored in.
 *
 * The mask is Sunday-first because `Date.getDay()` is and the scheduler tests
 * it directly - changing that would mean a conversion at every comparison. A
 * week starting on Sunday is only a numbering convention, though, and nobody
 * reading a day picker wants their weekend split across both ends of it. So
 * the bits stay where they are and the display walks them in this order.
 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const runsOnDay = (mask: number, day: number): boolean =>
  (mask & (1 << day)) !== 0;

export const toggleDay = (mask: number, day: number): number =>
  mask ^ (1 << day);

/**
 * The mask in words.
 *
 * The three sets people actually mean get their own name, because "Mon, Tue,
 * Wed, Thu & Fri" is a list you have to read to discover it says "weekdays".
 * Everything else is spelled out, and an empty mask says what it costs rather
 * than rendering as an empty line.
 */
export const daysLabel = (mask: number): string => {
  if (mask === EVERY_DAY) return "Every day";
  if (mask === WEEKDAYS) return "Weekdays";
  if (mask === WEEKENDS) return "Weekends";

  const picked = WEEK_ORDER.filter((day) => runsOnDay(mask, day)).map((day) =>
    DAY_NAMES[day].slice(0, 3),
  );
  if (picked.length === 0) return "No days picked";
  if (picked.length === 1) return picked[0] as string;
  return `${picked.slice(0, -1).join(", ")} & ${picked.at(-1)}`;
};

/**
 * How long ago, in the fewest words that are still true.
 *
 * Deliberately coarse. "Synced 2 min ago" is answering one question - is what I
 * am looking at current? - and a number that ticks every second invites the
 * reader to watch it rather than believe it. Nothing here is precise enough to
 * be worth re-reading, which is the point.
 */
export const agoOf = (at: number, now: number): string => {
  // A clock that has drifted backwards must not produce "in 3 minutes".
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};
