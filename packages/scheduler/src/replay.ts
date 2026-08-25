/**
 * When an action actually happened, as opposed to when we heard about it.
 *
 * Following a routine offline means the app records "started at 14:05" on a
 * plane and tells the server hours later. Stamping those with arrival time
 * would put a whole afternoon's activity in one minute, wreck the streaks and
 * progress they feed, and make the day's history a thing nobody can trust.
 *
 * So the client sends when it happened — which makes it untrusted input. A
 * device clock can be wrong, and a caller can lie. The rule is narrow on
 * purpose: believe the claim only inside a window that a genuine offline
 * stretch fits in, and otherwise fall back to now.
 */

/** Long enough for a holiday with no signal, short enough that nothing can
 *  rewrite a month of history. */
export const MAX_REPLAY_AGE_MS = 7 * 86_400_000;

/**
 * Resolve the instant to record for a replayed action.
 *
 * Falling back to `now` rather than clamping to the edge of the window is
 * deliberate. Clamping invents a specific past that nothing observed; `now` is
 * at least true about one thing — when the server learned of it.
 */
export function replayedAt(now: number, claimed: number | undefined): number {
  if (claimed === undefined || !Number.isFinite(claimed)) return now;

  // A clock ahead of ours, or a forged future: an action cannot have happened
  // after it was reported.
  if (claimed > now) return now;

  if (claimed < now - MAX_REPLAY_AGE_MS) return now;

  return claimed;
}
