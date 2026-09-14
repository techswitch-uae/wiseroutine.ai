const MINUTE = 60_000;

/** A repeated activity gets at most two hours a day, never more than 12
 * interruptions. Longer single sessions remain possible. This is a routine
 * configuration limit, not a claim that today's calendar has room. */
export function maxDailySessions(sessionMinutes: number): number {
  if (!Number.isFinite(sessionMinutes) || sessionMinutes <= 0)
    throw new RangeError("Session duration must be positive and finite");
  return Math.max(1, Math.min(12, Math.floor(120 / sessionMinutes)));
}

export const MIN_SIBLING_GAP_MS = 30 * MINUTE;
export const SPREAD_TOLERANCE = 0.6;

/** Clear time between the end of one session and the next. Shared by initial
 * placement and repair so a calendar change cannot bunch a daily routine. */
export function siblingGap(
  span: number,
  sessions: number,
  spread = true,
): number {
  return Math.max(
    MIN_SIBLING_GAP_MS,
    spread && sessions > 1 ? (span / sessions) * SPREAD_TOLERANCE : 0,
  );
}
