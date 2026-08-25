import { at, atOrNull, ms, msOrNull, type UserDatabase } from "../client";
import type {
  Slot as PrismaSlot,
  SlotEvent as PrismaSlotEvent,
} from "../generated/user/client";

export type SlotStatus =
  | "planned"
  | "live"
  | "started"
  | "completed"
  | "skipped"
  | "missed"
  | "cancelled";

export type SlotEventType =
  | "planned"
  | "auto_moved"
  | "user_moved"
  | "started"
  | "completed"
  | "skipped"
  | "missed"
  | "cancelled";

/**
 * Slots as the application sees them: instants are epoch-ms numbers, which is
 * what the scheduler and every route work in. The Date/number conversion stops
 * here, at the storage boundary.
 */
export interface SlotRow {
  id: string;
  activityId: string | null;
  reminderId: string | null;
  title: string;
  kind: "recovery" | "focus" | "task";
  startsAt: number;
  endsAt: number;
  timeZone: string;
  status: SlotStatus;
  isLocked: boolean;
  conflictEventId: string | null;
  conflictSeverity: string | null;
  autoMoveCount: number;
  planRunId: string | null;
  createdAt: number;
}

export interface SlotEventRow {
  id: string;
  slotId: string;
  at: number;
  type: SlotEventType;
  reasonCode: string | null;
  reasonText: string | null;
  fromStartsAt: number | null;
  toStartsAt: number | null;
  actor: "system" | "user";
}

const toSlot = (row: PrismaSlot): SlotRow => ({
  ...row,
  kind: row.kind as SlotRow["kind"],
  status: row.status as SlotStatus,
  startsAt: ms(row.startsAt),
  endsAt: ms(row.endsAt),
  createdAt: ms(row.createdAt),
});

const toSlotEvent = (row: PrismaSlotEvent): SlotEventRow => ({
  ...row,
  type: row.type as SlotEventType,
  actor: row.actor as "system" | "user",
  at: ms(row.at),
  fromStartsAt: msOrNull(row.fromStartsAt),
  toStartsAt: msOrNull(row.toStartsAt),
});

export async function listSlotsForRange(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: { startsAt: { gte: at(from), lt: at(to) } },
    orderBy: { startsAt: "asc" },
  });
  return rows.map(toSlot);
}

export async function getSlot(
  db: UserDatabase,
  slotId: string,
): Promise<SlotRow | undefined> {
  const row = await db.slot.findUnique({ where: { id: slotId } });
  return row ? toSlot(row) : undefined;
}

/**
 * Append to the slot's lifecycle log.
 *
 * Every state change goes through here. The missed list and the adaptive
 * nudges in screen 3d are both derived from this table, with the reason
 * attached — "moved twice, then no gap under 20 min appeared" is a query over
 * these rows, not a string someone stored on the slot.
 */
export async function recordSlotEvent(
  db: UserDatabase,
  input: {
    slotId: string;
    type: SlotEventType;
    actor: "system" | "user";
    reasonCode?: string;
    reasonText?: string;
    fromStartsAt?: number;
    toStartsAt?: number;
  },
  now: number,
  newId: () => string,
): Promise<void> {
  await db.slotEvent.create({
    data: {
      id: newId(),
      slotId: input.slotId,
      at: at(now),
      type: input.type,
      actor: input.actor,
      reasonCode: input.reasonCode ?? null,
      reasonText: input.reasonText ?? null,
      fromStartsAt: atOrNull(input.fromStartsAt),
      toStartsAt: atOrNull(input.toStartsAt),
    },
  });
}

export interface PlannedSlot {
  activityId: string | null;
  title: string;
  kind: "recovery" | "focus" | "task";
  startsAt: number;
  endsAt: number;
  timeZone: string;
}

/**
 * Replace the unsettled, unlocked slots in a window with a fresh plan.
 *
 * What survives a replan: anything the user pinned (`isLocked`), anything
 * already started or finished, and anything already logged as missed. A replan
 * must never quietly erase history or move a slot the user placed by hand.
 */
export async function replacePlannedSlots(
  db: UserDatabase,
  params: { from: number; to: number; planRunId: string },
  planned: readonly PlannedSlot[],
  now: number,
  newId: () => string,
): Promise<{ removed: number; created: number }> {
  const replaceable = await db.slot.findMany({
    where: {
      startsAt: { gte: at(params.from), lt: at(params.to) },
      isLocked: false,
      status: "planned",
    },
    select: { id: true },
  });

  const ids = replaceable.map((r) => r.id);
  if (ids.length > 0) {
    await db.slotEvent.deleteMany({ where: { slotId: { in: ids } } });
    await db.slot.deleteMany({ where: { id: { in: ids } } });
  }

  for (const slot of planned) {
    const id = newId();
    await db.slot.create({
      data: {
        id,
        activityId: slot.activityId,
        title: slot.title,
        kind: slot.kind,
        startsAt: at(slot.startsAt),
        endsAt: at(slot.endsAt),
        timeZone: slot.timeZone,
        status: "planned",
        planRunId: params.planRunId,
        createdAt: at(now),
      },
    });
    await recordSlotEvent(
      db,
      { slotId: id, type: "planned", actor: "system" },
      now,
      newId,
    );
  }

  return { removed: ids.length, created: planned.length };
}

export async function moveSlot(
  db: UserDatabase,
  params: {
    slotId: string;
    startsAt: number;
    endsAt: number;
    actor: "system" | "user";
    reasonCode?: string;
    reasonText?: string;
  },
  now: number,
  newId: () => string,
): Promise<void> {
  const current = await getSlot(db, params.slotId);
  if (!current) return;

  await db.slot.update({
    where: { id: params.slotId },
    data: {
      startsAt: at(params.startsAt),
      endsAt: at(params.endsAt),
      // A user-placed slot is pinned from then on, so the next replan leaves it
      // alone. Auto-moves stay movable but count toward the thrash cap.
      isLocked: params.actor === "user" ? true : current.isLocked,
      autoMoveCount:
        params.actor === "system"
          ? current.autoMoveCount + 1
          : current.autoMoveCount,
    },
  });

  await recordSlotEvent(
    db,
    {
      slotId: params.slotId,
      type: params.actor === "user" ? "user_moved" : "auto_moved",
      actor: params.actor,
      ...(params.reasonCode !== undefined
        ? { reasonCode: params.reasonCode }
        : {}),
      ...(params.reasonText !== undefined
        ? { reasonText: params.reasonText }
        : {}),
      fromStartsAt: current.startsAt,
      toStartsAt: params.startsAt,
    },
    now,
    newId,
  );
}

export async function setSlotStatus(
  db: UserDatabase,
  params: {
    slotId: string;
    status: SlotStatus;
    actor: "system" | "user";
    reasonCode?: string;
    reasonText?: string;
  },
  now: number,
  newId: () => string,
): Promise<void> {
  await db.slot.updateMany({
    where: { id: params.slotId },
    data: { status: params.status },
  });

  const typeByStatus: Partial<Record<SlotStatus, SlotEventType>> = {
    started: "started",
    completed: "completed",
    skipped: "skipped",
    missed: "missed",
    cancelled: "cancelled",
  };
  const type = typeByStatus[params.status];
  if (!type) return;

  await recordSlotEvent(
    db,
    {
      slotId: params.slotId,
      type,
      actor: params.actor,
      ...(params.reasonCode !== undefined
        ? { reasonCode: params.reasonCode }
        : {}),
      ...(params.reasonText !== undefined
        ? { reasonText: params.reasonText }
        : {}),
    },
    now,
    newId,
  );
}

/**
 * Slots whose grace period has run out, inside this user's database.
 *
 * The cron ticker no longer scans every user — it reads the directory's
 * coordination table and fans out. This runs once the user's database is open.
 */
export interface ConflictMark {
  slotId: string;
  eventId: string;
  severity: string;
}

/**
 * Record which slots a synced meeting now sits on top of.
 *
 * The columns existed before anything wrote them, so `/today` has always
 * returned `conflictEventId: null`. A conflict that only exists as a
 * computed answer to `/conflicts` cannot be shown on the timeline someone is
 * actually looking at.
 *
 * Clearing first is what makes this idempotent: a meeting moved *off* a slot
 * has to drop the marker, and there is no event to hang that on other than
 * the same recalculation that found the new ones.
 */
export async function markConflicts(
  db: UserDatabase,
  range: { from: number; to: number },
  conflicts: readonly ConflictMark[],
): Promise<void> {
  await db.slot.updateMany({
    where: { startsAt: { gte: at(range.from), lt: at(range.to) } },
    data: { conflictEventId: null, conflictSeverity: null },
  });

  for (const conflict of conflicts) {
    await db.slot.update({
      where: { id: conflict.slotId },
      data: {
        conflictEventId: conflict.eventId,
        conflictSeverity: conflict.severity,
      },
    });
  }
}

export async function slotsPastGrace(
  db: UserDatabase,
  now: number,
  limit: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: { status: "planned", startsAt: { lte: at(now) }, isLocked: false },
    orderBy: { startsAt: "asc" },
    take: limit,
  });
  return rows.map(toSlot);
}

/** The next moment anything in this database needs attention, so the directory
 *  can be told when to come back. */
export async function nextGraceDeadline(
  db: UserDatabase,
  after: number,
): Promise<number | undefined> {
  const row = await db.slot.findFirst({
    where: { status: "planned", startsAt: { gt: at(after) } },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true },
  });
  return row ? ms(row.startsAt) : undefined;
}

/** Progress so far, for the solver's demand calculation. */
export async function progressForRange(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<Map<string, { count: number; minutes: number }>> {
  const rows = await db.slot.findMany({
    where: { startsAt: { gte: at(from), lt: at(to) }, status: "completed" },
    select: { activityId: true, startsAt: true, endsAt: true },
  });

  const byActivity = new Map<string, { count: number; minutes: number }>();
  for (const row of rows) {
    if (!row.activityId) continue;
    const current = byActivity.get(row.activityId) ?? { count: 0, minutes: 0 };
    byActivity.set(row.activityId, {
      count: current.count + 1,
      minutes:
        current.minutes +
        Math.round((ms(row.endsAt) - ms(row.startsAt)) / 60_000),
    });
  }
  return byActivity;
}

/** 3d: the honest list. Anything that did not happen, with its recorded why. */
export async function listMissed(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: {
      startsAt: { gte: at(from), lt: at(to) },
      status: { in: ["missed", "skipped"] },
    },
    orderBy: { startsAt: "asc" },
  });
  return rows.map(toSlot);
}

export async function listSlotEvents(
  db: UserDatabase,
  slotIds: readonly string[],
): Promise<SlotEventRow[]> {
  if (slotIds.length === 0) return [];
  const rows = await db.slotEvent.findMany({
    where: { slotId: { in: [...slotIds] } },
    orderBy: { at: "asc" },
  });
  return rows.map(toSlotEvent);
}

export async function createPlanRun(
  db: UserDatabase,
  input: {
    localDate: string;
    trigger: string;
    engineVersion: string;
    inputsHash: string;
    placedCount: number;
    unplacedCount: number;
    durationMs?: number | null;
  },
  now: number,
  newId: () => string,
): Promise<string> {
  const id = newId();
  await db.planRun.create({
    data: {
      id,
      localDate: input.localDate,
      trigger: input.trigger,
      engineVersion: input.engineVersion,
      inputsHash: input.inputsHash,
      placedCount: input.placedCount,
      unplacedCount: input.unplacedCount,
      durationMs: input.durationMs ?? null,
      createdAt: at(now),
    },
  });
  return id;
}
