/**
 * What is true of one block, in one sentence and three booleans.
 *
 * Beside the module that renders it rather than inside it, because this is the
 * part with the rules in it: which states can still be started, which are
 * pinned, and why. "Locked" on its own is the kind of word an app uses when it
 * does not want to explain itself, so every state here owes a reason.
 *
 * `movable` is deliberately the same rule the timeline drags by - see
 * `movable` on `TimelineRow`. Two places deciding whether a block can be moved
 * is how they end up disagreeing about it.
 */

import type { TodaySlot } from "./api";

export interface SlotState {
  /** The sentence under the time. */
  note: string;
  /** Can be started, or picked back up after being stopped. */
  startable: boolean;
  /** Running right now, so it can be finished or stopped. */
  running: boolean;
  /** Can still be nudged. */
  movable: boolean;
  /**
   * Started, and its time has since run out with nobody saying how it went.
   *
   * A state the day can genuinely be left in: a manual session is finished
   * from inside itself, so closing the window mid-stretch leaves the row
   * `started` with nothing to close it. The server does eventually call it
   * missed, but only an hour later, and until then this is a block the user
   * can still tell the truth about.
   */
  unresolved: boolean;
}

/**
 * `now` is not optional, and that is the fix this signature exists for.
 *
 * Every state here was decided from the status alone, so a block started
 * yesterday still read "Running now", and stopping it offered to "resume it
 * while its time is still running" - about a slot whose time ran out sixteen
 * hours ago. A status says what happened; only the clock says whether it can
 * still be acted on.
 */
export function slotState(slot: TodaySlot, now: number): SlotState {
  /** Its window has closed. Nothing can be started or resumed into a stretch
   *  of the day that has already gone past. */
  const over = now >= slot.endsAt;

  switch (slot.status) {
    case "started":
      if (over)
        return {
          note: "Started, but never finished - the app was closed before it ended. Say what happened and it stops asking.",
          startable: false,
          running: false,
          movable: false,
          unresolved: true,
        };
      return {
        note: "Running now. It stays where it is until it is finished.",
        startable: false,
        running: true,
        movable: false,
        unresolved: false,
      };
    case "completed":
      return {
        note: "Done. This is the record that it happened at this time, so it does not move.",
        startable: false,
        running: false,
        movable: false,
        unresolved: false,
      };
    case "skipped":
      // The offer of a resume was unconditional, which is how a block from
      // yesterday came to say its time was still running.
      if (over)
        return {
          note: "Stopped before it finished, and its time has passed.",
          startable: false,
          running: false,
          movable: false,
          unresolved: false,
        };
      return {
        note: "Stopped before it finished. You can resume it while its time is still running.",
        startable: true,
        running: false,
        movable: false,
        unresolved: false,
      };
    case "missed":
      return {
        note: "Missed. It stays on the day as what actually happened.",
        startable: false,
        running: false,
        movable: false,
        unresolved: false,
      };
    default:
      // Planned. A slot whose time has gone by is not startable either - the
      // sweep is on its way to calling it missed, and offering Start in the
      // meantime promises a session that would begin in the past.
      if (over)
        return {
          note: "Its time has passed. It will be recorded as missed.",
          startable: false,
          running: false,
          movable: false,
          unresolved: false,
        };
      return {
        note: slot.isLocked
          ? "You placed this one, so the planner leaves it where it is."
          : "Not started yet. Nudge it, or start it whenever you are ready.",
        startable: true,
        running: false,
        movable: true,
        unresolved: false,
      };
  }
}
