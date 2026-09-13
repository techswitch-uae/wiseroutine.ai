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

/** Started work must be stopped explicitly; postponing never ends it implicitly. */
export function canPostponeSlot(slot: { status: string }): boolean {
  return ["planned", "live", "skipped", "missed", "bucketed"].includes(
    slot.status,
  );
}
