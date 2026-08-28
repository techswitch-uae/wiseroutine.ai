import { describe, expect, test } from "vitest";
import {
  ACTIVE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  RECENT_INTERVAL_MS,
  shouldSyncOnForeground,
  shouldTouchLastSeen,
  syncInterval,
  TOUCH_DEBOUNCE_MS,
} from "./cadence";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_700_000_000_000;

describe("syncInterval", () => {
  test("someone at the keyboard is polled on the short interval", () => {
    expect(syncInterval(NOW - MINUTE, NOW)).toBe(ACTIVE_INTERVAL_MS);
    expect(syncInterval(NOW - 29 * MINUTE, NOW)).toBe(ACTIVE_INTERVAL_MS);
  });

  test("someone who used it earlier today backs off to hourly", () => {
    expect(syncInterval(NOW - 2 * HOUR, NOW)).toBe(RECENT_INTERVAL_MS);
    expect(syncInterval(NOW - 23 * HOUR, NOW)).toBe(RECENT_INTERVAL_MS);
  });

  test("a dormant account is polled four times a day, not ninety-six", () => {
    expect(syncInterval(NOW - 8 * 24 * HOUR, NOW)).toBe(IDLE_INTERVAL_MS);
  });

  // The case that pays for this whole module: a signup that connected a
  // calendar and never came back must not be treated as active.
  test("never having opened the app is dormant, not active", () => {
    expect(syncInterval(null, NOW)).toBe(IDLE_INTERVAL_MS);
    expect(syncInterval(undefined, NOW)).toBe(IDLE_INTERVAL_MS);
  });

  // A device clock ahead of the server would otherwise compute a negative
  // "since" - which must not read as ancient.
  test("a timestamp in the future is treated as just now", () => {
    expect(syncInterval(NOW + HOUR, NOW)).toBe(ACTIVE_INTERVAL_MS);
  });

  test("intervals only ever get longer as attention fades", () => {
    const points = [0, MINUTE, HOUR, 12 * HOUR, 48 * HOUR];
    const intervals = points.map((since) => syncInterval(NOW - since, NOW));
    expect(intervals).toEqual([...intervals].sort((a, b) => a - b));
  });
});

describe("shouldTouchLastSeen", () => {
  test("a first-ever request records", () => {
    expect(shouldTouchLastSeen(null, NOW)).toBe(true);
  });

  test("a burst of requests writes once", () => {
    expect(shouldTouchLastSeen(NOW - 1_000, NOW)).toBe(false);
    expect(shouldTouchLastSeen(NOW - TOUCH_DEBOUNCE_MS, NOW)).toBe(true);
  });
});

describe("shouldSyncOnForeground", () => {
  test("a first-ever request syncs rather than showing a stale day", () => {
    expect(shouldSyncOnForeground(null, NOW)).toBe(true);
  });

  /**
   * The reason this is not the same threshold as the touch above. Someone with
   * the app open all day hits these routes constantly; syncing on each of them
   * once a minute would be sixty provider passes an hour, four times worse
   * than the poll it is meant to relieve.
   */
  test("clicking around inside the active window never enqueues a sync", () => {
    for (const since of [0, MINUTE, 5 * MINUTE, 14 * MINUTE]) {
      expect(shouldSyncOnForeground(NOW - since, NOW)).toBe(false);
    }
  });

  test("arriving after longer than the poll interval syncs", () => {
    // Away 20 min: the poll we would have scheduled was 15, so this is stale.
    expect(shouldSyncOnForeground(NOW - 20 * MINUTE, NOW)).toBe(true);
    // Away a day: unambiguously.
    expect(shouldSyncOnForeground(NOW - 24 * HOUR, NOW)).toBe(true);
  });

  // The threshold is derived from syncInterval, so it must never be shorter
  // than the touch debounce - the middleware only asks it once touching has
  // already been allowed, and a shorter threshold would silently skip syncs.
  test("the sync threshold is always the longer of the two", () => {
    for (const since of [0, MINUTE, HOUR, 30 * HOUR]) {
      expect(syncInterval(NOW - since, NOW)).toBeGreaterThan(TOUCH_DEBOUNCE_MS);
    }
  });
});
