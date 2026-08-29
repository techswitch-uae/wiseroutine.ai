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
}

export function slotState(slot: TodaySlot): SlotState {
  switch (slot.status) {
    case "started":
      return {
        note: "Running now. It stays where it is until it is finished.",
        startable: false,
        running: true,
        movable: false,
      };
    case "completed":
      return {
        note: "Done. This is the record that it happened at this time, so it does not move.",
        startable: false,
        running: false,
        movable: false,
      };
    case "skipped":
      return {
        note: "Stopped before it finished. You can resume it while its time is still running.",
        startable: true,
        running: false,
        movable: false,
      };
    case "missed":
      return {
        note: "Missed. It stays on the day as what actually happened.",
        startable: false,
        running: false,
        movable: false,
      };
    default:
      return {
        note: slot.isLocked
          ? "You placed this one, so the planner leaves it where it is."
          : "Not started yet. Nudge it, or start it whenever you are ready.",
        startable: true,
        running: false,
        movable: true,
      };
  }
}
