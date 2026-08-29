/**
 * Which slot, if any, is currently taking over the window.
 *
 * A rule rather than a component, so it can be stated and tested without
 * mounting anything.
 */

import type { TodaySlot } from "./api";

/**
 * The one slot that is running, if it has something to show.
 *
 * Exported and pure so the rule - started, and has a module - is testable
 * without mounting anything. Two started slots should never exist, but if the
 * clock and a stale plan ever produce them, the earlier one wins rather than
 * whichever the array happened to list first.
 */
export function runningSlot(
  slots: readonly TodaySlot[],
): TodaySlot | undefined {
  return slots
    .filter((slot) => slot.status === "started" && slot.presetKey)
    .sort((a, b) => a.startsAt - b.startsAt)[0];
}
