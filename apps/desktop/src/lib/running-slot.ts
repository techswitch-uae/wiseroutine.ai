/**
 * Which slot, if any, is currently taking over the window.
 *
 * A rule rather than a component, so it can be stated and tested without
 * mounting anything.
 */

import type { TodaySlot } from "./api";

/**
 * The slots this run of the app has actually started.
 *
 * `started` outlives the app. It is a row in a database, the server sets it on
 * its own for an activity that starts itself, and nothing clears it if the
 * window was closed at the time - so relaunching used to drop you straight
 * into a full-screen session you had never opened, for a block you may have
 * walked away from an hour ago. A session is something you are in, not
 * something the day remembers about you.
 *
 * Deliberately not persisted. Quitting is leaving the session; the row stays
 * `started` and the server's own sweep is what decides whether it was
 * completed or missed.
 */
const startedHere = new Set<string>();

/** Called by the one place that starts a slot - see `start` on Today. */
export const markStarted = (slotId: string): void => {
  startedHere.add(slotId);
};

/** Only for tests, which cannot restart the process between cases. */
export const forgetStarted = (): void => startedHere.clear();

/**
 * The one slot that is running, if it has something to show.
 *
 * Four conditions, and the last two earn their place. `now < endsAt` because
 * `started` is a status nothing clears: a slot left started at nine is still
 * started at four, and "earliest started wins" would hand the window to a
 * session whose time ran out hours ago instead of the one just pressed. And
 * `startedHere`, because a session is a thing you entered - see above.
 *
 * Two at once should not happen. If the clock and a stale plan ever produce
 * them, the earlier one wins rather than whichever the array happened to list
 * first.
 */
export function runningSlot(
  slots: readonly TodaySlot[],
  now: number,
): TodaySlot | undefined {
  return slots
    .filter(
      (slot) =>
        slot.status === "started" &&
        slot.presetKey &&
        now < slot.endsAt &&
        startedHere.has(slot.id),
    )
    .sort((a, b) => a.startsAt - b.startsAt)[0];
}
