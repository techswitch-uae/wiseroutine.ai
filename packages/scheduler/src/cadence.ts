/**
 * How often to poll a calendar when nobody has asked.
 *
 * The provider push channels are what actually keep a calendar fresh - a
 * change arrives as a notification, and the sync runs within seconds. This
 * poll exists for the case where a notification never came: a channel that
 * expired early, a delivery Google dropped, a Graph subscription that lapsed.
 * It is a safety net, not the mechanism.
 *
 * Which means polling every fifteen minutes forever is mostly paying to
 * discover that nothing changed. Someone who last opened the app on Tuesday
 * does not need ninety-six checks a day; the app will sync on open anyway, and
 * a push would have woken it in between. So the interval follows attention.
 *
 * What this deliberately does *not* do is narrow the sync window per view.
 * Google refuses `timeMin`/`timeMax` alongside a `syncToken`, and Graph encodes
 * the range inside the delta token - so a window per view means a full fetch
 * per view instead of one incremental call. Cadence is the axis with room in
 * it; range is not.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Foreground: the app is open and being looked at. */
export const ACTIVE_INTERVAL_MS = 15 * MINUTE;
/** Used it today, but not right now. */
export const RECENT_INTERVAL_MS = HOUR;
/** Away. Pushes still arrive; this is only the net beneath them. */
export const IDLE_INTERVAL_MS = 6 * HOUR;

/** Still counts as "at the keyboard" after the last request. */
export const ACTIVE_WINDOW_MS = 30 * MINUTE;
/** Beyond this, treat the account as dormant. */
export const RECENT_WINDOW_MS = 24 * HOUR;

/**
 * How long until this calendar should be polled again.
 *
 * `lastSeenAt` is null for an account that has never opened the app - a
 * signup that connected a calendar and left. That is the dormant case, not the
 * active one, so it gets the longest interval rather than the shortest.
 */
export function syncInterval(
  lastSeenAt: number | null | undefined,
  now: number,
): number {
  if (lastSeenAt === null || lastSeenAt === undefined) return IDLE_INTERVAL_MS;

  // A clock skew that puts `lastSeenAt` in the future must not read as
  // "ancient" and push the user into the idle bucket.
  const since = Math.max(0, now - lastSeenAt);

  if (since <= ACTIVE_WINDOW_MS) return ACTIVE_INTERVAL_MS;
  if (since <= RECENT_WINDOW_MS) return RECENT_INTERVAL_MS;
  return IDLE_INTERVAL_MS;
}

/**
 * Two different questions, and conflating them is expensive.
 *
 * *Recording* that someone is here is one small write, and it should happen
 * often enough that `syncInterval` stays honest - debounced only enough that
 * a chatty client does not write per request.
 *
 * *Syncing* is a provider call. Doing that on the same one-minute debounce
 * would mean sixty syncs an hour for someone with the app open - four times
 * worse than the fifteen-minute poll it is supposed to relieve.
 */
export const TOUCH_DEBOUNCE_MS = MINUTE;

/** Whether to spend a directory write recording this request. */
export function shouldTouchLastSeen(
  lastSeenAt: number | null | undefined,
  now: number,
): boolean {
  if (lastSeenAt === null || lastSeenAt === undefined) return true;
  return now - lastSeenAt >= TOUCH_DEBOUNCE_MS;
}

/**
 * Whether arriving now warrants a sync.
 *
 * The rule is derived rather than another tuned constant: sync if more time
 * has passed than the poll we would have scheduled anyway. Someone clicking
 * around inside their fifteen-minute window is already covered and gets
 * nothing; someone back after a day is exactly the person whose view would
 * otherwise open stale.
 *
 * It self-adjusts with the intervals above, so there is no second set of
 * thresholds to keep in step with the first.
 */
export function shouldSyncOnForeground(
  lastSeenAt: number | null | undefined,
  now: number,
): boolean {
  // Never seen: their first view should not be built from whatever the last
  // background poll happened to leave behind.
  if (lastSeenAt === null || lastSeenAt === undefined) return true;
  return now - lastSeenAt >= syncInterval(lastSeenAt, now);
}
