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
const startedHere = new Map<string, number>();

/** Called by the one place that starts a slot - see `start` on Today.
 *
 *  The instant is kept, not just the fact: a block started before its window
 *  opens still runs for as long as it was planned to, and the only thing that
 *  knows when it actually began is the press. */
export const markStarted = (slotId: string, at = Date.now()): void => {
  startedHere.set(slotId, at);
};

/** When this run started that slot, or undefined if it did not. */
export const startedAtOf = (slotId: string): number | undefined =>
  startedHere.get(slotId);

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

/**
 * How long the session actually runs for.
 *
 * Not simply `slot.endsAt`, which is where the block is *parked* on the day.
 * A three-minute breathing block you press six minutes early was counting down
 * to its parking space, so it opened saying "9 min left" and would have paced
 * you for nine. What was asked for is three minutes of breathing, and the
 * press is the only thing that knows when they began.
 *
 * Still capped at the block's own end, because `runningSlot` closes the
 * overlay there: a session allowed to run past it would be taken off screen
 * mid-breath. So a late start gets the rest of its window rather than a fresh
 * full length.
 *
 * ponytail: derived at render from the press instant `markStarted` already
 * keeps. The alternative - the server re-anchoring the slot on start - moves
 * a block on the timeline out from under the user, and needs a migration to
 * store what the press already knows.
 *
 * Here rather than beside the overlay for two reasons. It reads
 * `startedAtOf`, which lives here, and it is the only other thing that knows
 * what the press instant is *for*. And exporting it from a module that also
 * exports a component costs that component fast refresh.
 *
 * Exported because it needs its own test: the countdown it decides is drawn
 * inside the addon's frame now - an iframe with an opaque origin, which jsdom
 * will not run - so the only way left to assert this rule is to ask it
 * directly. That is the better test anyway. It is a rule about instants, and
 * it was being checked by reading two digits off a screen.
 */
export const sessionEndOf = (slot: TodaySlot): number => {
  const startedAt = startedAtOf(slot.id);
  if (startedAt === undefined) return slot.endsAt;
  return Math.min(startedAt + (slot.endsAt - slot.startsAt), slot.endsAt);
};
