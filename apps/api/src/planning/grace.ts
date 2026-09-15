import { canStartSlot } from "@wiseroutine/scheduler";

/** Background time passing never moves a manual slot or guesses its outcome.
 * Guided auto-start is the only start policy with a background mutation. */
export interface GraceInput {
  status: string;
  startsAt: number;
  endsAt: number;
  startPolicy: string;
}

export function graceAction(slot: GraceInput, now: number): "start" | "leave" {
  return slot.startPolicy === "auto" &&
    ["planned", "live"].includes(slot.status) &&
    now >= slot.startsAt &&
    canStartSlot(slot, now)
    ? "start"
    : "leave";
}
