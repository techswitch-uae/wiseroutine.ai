/**
 * How long is left of a trial or a founding grant.
 *
 * Two lines of arithmetic, and both of them are decisions: whether the last
 * hours of a trial count as a day, and what zero is called.
 */

/** Whole days, rounded up: the last hours of a trial are still "1 day left"
 *  rather than a zero that reads as already over. */
export function daysLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 86_400_000));
}

export function trialLabel(days: number): string {
  if (days === 0) return "Ends today";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
