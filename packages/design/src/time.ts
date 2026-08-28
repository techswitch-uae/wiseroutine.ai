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
