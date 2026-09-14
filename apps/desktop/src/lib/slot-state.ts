import type { TodaySlot } from "./api";

/** Lifecycle permissions shared by the timeline and the selected-slot widget.
 * Time bounds matter even when a cached status has not caught up yet. */
export interface SlotState {
  /** Brief status, not instructions. Routine planned slots need no extra line. */
  label: string | null;
  startable: boolean;
  running: boolean;
  movable: boolean;
  /** A started slot whose time ended without a recorded outcome. */
  unresolved: boolean;
}

const inactive = {
  startable: false,
  running: false,
  movable: false,
  unresolved: false,
};

export function slotState(slot: TodaySlot, now: number): SlotState {
  const over = now >= slot.endsAt;

  switch (slot.status) {
    case "started":
      return over
        ? { ...inactive, label: "Needs confirmation", unresolved: true }
        : { ...inactive, label: "Running", running: true };
    case "completed":
      return { ...inactive, label: "Done" };
    case "skipped":
      return { ...inactive, label: "Stopped", startable: !over };
    case "missed":
      return { ...inactive, label: "Missed" };
    case "cancelled":
    case "bucketed":
      return { ...inactive, label: null };
    default:
      if (over) return { ...inactive, label: "Time passed", movable: true };
      return {
        ...inactive,
        label: slot.isLocked ? "Placed by you" : null,
        startable: true,
        movable: true,
      };
  }
}
