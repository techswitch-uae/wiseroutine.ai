/** The short undo window after an actual Start, not the slot's scheduled time. */
export interface StartedSlot {
  status: string;
  startsAt: number;
  endsAt: number;
  /** Missing on older cached plans: do not invent a fresh stop window. */
  startedAt?: number | null;
}

export function slotStopDeadline(slot: StartedSlot): number | null {
  if (
    slot.status !== "started" ||
    slot.startedAt == null ||
    !Number.isFinite(slot.startedAt) ||
    !Number.isFinite(slot.startsAt) ||
    !Number.isFinite(slot.endsAt) ||
    slot.endsAt <= slot.startsAt
  )
    return null;
  return Math.min(
    slot.startedAt + Math.min((slot.endsAt - slot.startsAt) / 2, 120_000),
    slot.endsAt,
  );
}

export function canStopSlot(slot: StartedSlot, now: number): boolean {
  const deadline = slotStopDeadline(slot);
  return (
    deadline !== null && now >= (slot.startedAt as number) && now < deadline
  );
}

type TimedSlot = Pick<StartedSlot, "status" | "startsAt" | "endsAt">;

/** Resume and movement close two minutes after the scheduled start.
 * An early Start/Stop never renews it. Short slots close at their end. */
export function slotActionDeadline(
  slot: Pick<TimedSlot, "startsAt" | "endsAt">,
): number | null {
  if (
    !Number.isFinite(slot.startsAt) ||
    !Number.isFinite(slot.endsAt) ||
    slot.endsAt <= slot.startsAt
  )
    return null;
  return Math.min(slot.startsAt + 120_000, slot.endsAt);
}

export function canStartSlot(slot: TimedSlot, now: number): boolean {
  const deadline = slotActionDeadline(slot);
  return (
    ["planned", "live", "skipped"].includes(slot.status) &&
    deadline !== null &&
    Number.isFinite(now) &&
    now < (slot.status === "skipped" ? deadline : slot.endsAt)
  );
}

/** Not placed has no appointment to expire. Missed/done history never moves.
 * First Start remains available after this window, but never renews movement. */
export function canPostponeSlot(slot: TimedSlot, now: number): boolean {
  const deadline = slotActionDeadline(slot);
  return slot.status === "bucketed" || (
    ["planned", "live", "skipped"].includes(slot.status) &&
    deadline !== null && Number.isFinite(now) && now < deadline
  );
}

/** Calendar repair only moves pending appointments, never stopped history. */
export function canRepairSlot(slot: TimedSlot, now: number): boolean {
  return ["planned", "live"].includes(slot.status) && canPostponeSlot(slot, now);
}
