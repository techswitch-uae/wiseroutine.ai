import {
  canPostponeSlot,
  canStartSlot,
  canStopSlot,
  dayBounds,
  localDateOf,
} from "@wiseroutine/scheduler";
import {
  at,
  atOrNull,
  isTransaction,
  ms,
  msOrNull,
  type UserDatabase,
  userTransaction,
} from "../client";

export class ActionConflict extends Error {}

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
  | "cancelled"
  /**
   * In the bucket: the day moved under it and there is nowhere we would stand
   * behind putting it.
   *
   * A status rather than a table of its own. A bucketed session is the same
   * row it always was - same activity, same length, same lifecycle log - it
   * has simply lost its place on the day, and the log already carries the two
   * things the bucket has to say: why, and where we would have put it. See
   * `listBucket`.
   *
   * It holds no time, so nothing that draws the day draws it, and nothing that
   * counts what is scheduled counts it. Giving it a time takes it back out -
   * see `moveSlot`.
   */
  | "bucketed";

export type SlotEventType =
  | "planned"
  | "auto_moved"
  | "user_moved"
  | "started"
  | "completed"
  | "skipped"
  | "missed"
  | "cancelled"
  | "bucketed";

/**
 * Slots as the application sees them: instants are epoch-ms numbers, which is
 * what the scheduler and every route work in. The Date/number conversion stops
 * here, at the storage boundary.
 */
/** Who did it. An addon's writes are logged apart from the user's. */
export type SlotActor = "system" | "user" | "addon";

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
  /** The addon that placed it, or null. Only that addon may change it. */
  ownerAddonId: string | null;
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
  actor: SlotActor;
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
  actor: row.actor as SlotActor,
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
    where: { startsAt: { lt: at(to) }, endsAt: { gt: at(from) } },
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
 * attached - "moved twice, then no gap under 20 min appeared" is a query over
 * these rows, not a string someone stored on the slot.
 */
export async function recordSlotEvent(
  db: UserDatabase,
  input: {
    slotId: string;
    type: SlotEventType;
    actor: SlotActor;
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
  params: {
    from: number;
    to: number;
    planRunId: string;
    preserveIds?: readonly string[];
  },
  planned: readonly PlannedSlot[],
  now: number,
  newId: () => string,
): Promise<{ removed: number; created: number }> {
  if (!isTransaction(db))
    return userTransaction(db, (tx) =>
      replacePlannedSlots(tx, params, planned, now, newId),
    );
  const replaceable = await db.slot.findMany({
    where: {
      startsAt: { gte: at(params.from), lt: at(params.to) },
      isLocked: false,
      status: "planned",
      ...(params.preserveIds ? { id: { notIn: [...params.preserveIds] } } : {}),
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

/**
 * Put a slot on the day because the user said so.
 *
 * The free plan's whole shape: you choose the activity and the time, and what
 * you chose is what happens. Locked from the moment it is created, so the next
 * replan works around it rather than over it - the same pin `moveSlot` sets
 * when a slot is dragged, applied at birth rather than on the first move.
 *
 * `actor: "user"` on the event as well, which is what lets the missed list
 * later tell "you put this here and it did not happen" apart from "we placed
 * this and it did not fit".
 */
export async function placeSlot(
  db: UserDatabase,
  params: {
    /** Null for a todo put on the day: it has a reminder and no activity. */
    activityId: string | null;
    reminderId?: string | null;
    title: string;
    kind: string;
    startsAt: number;
    endsAt: number;
    timeZone: string;
    /** Set when an addon placed it. */
    ownerAddonId?: string | null;
  },
  now: number,
  newId: () => string,
): Promise<SlotRow> {
  if (!isTransaction(db))
    return userTransaction(db, (tx) => placeSlot(tx, params, now, newId));
  const id = newId();
  await db.slot.create({
    data: {
      id,
      activityId: params.activityId,
      reminderId: params.reminderId ?? null,
      ownerAddonId: params.ownerAddonId ?? null,
      title: params.title,
      kind: params.kind,
      startsAt: at(params.startsAt),
      endsAt: at(params.endsAt),
      timeZone: params.timeZone,
      status: "planned",
      isLocked: true,
      createdAt: at(now),
    },
  });

  await recordSlotEvent(
    db,
    {
      slotId: id,
      type: "planned",
      actor: params.ownerAddonId ? "addon" : "user",
      reasonCode: "placed_by_hand",
    },
    now,
    newId,
  );

  const row = await getSlot(db, id);
  if (!row) throw new Error("slot vanished after being created");
  return row;
}

/**
 * Take an activity's unstarted slots off the day.
 *
 * The rule when an activity is archived: **cancel the unstarted future, never
 * edit history**. Three cases, and each is a promise:
 *
 *   - `completed` / `skipped` / `missed` are left exactly as they are. They are
 *     what the missed list and every progress number are built from, and an
 *     activity being deleted today must not change what happened last Tuesday.
 *   - A slot that is `started` right now is left running. Yanking the window
 *     away from someone mid-stretch is worse than one stray completion, and it
 *     will close itself in a minute either way.
 *   - Everything `planned` or `live` is **cancelled**, not deleted, so the
 *     lifecycle log keeps the reason. `buildTimeline` already skips cancelled
 *     slots, so they leave the timeline without leaving a hole in the record.
 *
 * Returns how many were taken off, which is the only number the UI needs to
 * say what just happened.
 */
export async function cancelUnstartedSlots(
  db: UserDatabase,
  params: { activityId: string; from: number; reasonCode: string },
  now: number,
  newId: () => string,
): Promise<number> {
  const rows = await db.slot.findMany({
    where: {
      activityId: params.activityId,
      // Bucket timestamps are day keys, not appointments. Even an older
      // bucket entry must leave when its activity is archived.
      OR: [
        { status: "bucketed" },
        {
          status: { in: ["planned", "live"] },
          startsAt: { gte: at(params.from) },
        },
      ],
    },
    select: { id: true },
  });

  for (const row of rows) {
    await setSlotStatus(
      db,
      {
        slotId: row.id,
        status: "cancelled",
        actor: "user",
        reasonCode: params.reasonCode,
      },
      now,
      newId,
    );
  }

  return rows.length;
}

export async function moveSlot(
  db: UserDatabase,
  params: {
    /** The account's current zone may differ from the slot's original zone. */
    timeZone?: string;
    slotId: string;
    startsAt: number;
    endsAt: number;
    actor: SlotActor;
    reasonCode?: string;
    reasonText?: string;
  },
  now: number,
  newId: () => string,
): Promise<void> {
  if (!isTransaction(db))
    return userTransaction(db, (tx) => moveSlot(tx, params, now, newId));
  const current = await getSlot(db, params.slotId);
  if (!current) return;
  if (expiredRoutineBucket(current, now, params.timeZone))
    throw new ActionConflict(
      "This unplaced slot belonged to a previous day. Use today's routine instead.",
    );
  if (
    params.actor === "system"
      ? !["planned", "live", "bucketed"].includes(current.status)
      : !canPostponeSlot(current, now)
  )
    throw new ActionConflict(
      "This slot can no longer be moved. You can still mark it done.",
    );
  if (current.reminderId) {
    const todo = await db.reminder.findUnique({
      where: { id: current.reminderId },
    });
    if (todo?.status === "done" || (todo?.slotId && todo.slotId !== current.id))
      throw new ActionConflict(
        "This todo has a newer appointment or is already done.",
      );
  }

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
      // A stopped slot moved inside its start window is the same occurrence.
      // Its earlier Start/Stop events remain in the log, not a duplicate row.
      status: ["bucketed", "live", "skipped"].includes(current.status)
        ? "planned"
        : current.status,
      // Wherever it has gone, it is not under the meeting it was under. The
      // marker is a cache of an overlap, and this call just invalidated it -
      // which was true of a slot dragged clear by hand long before the bucket
      // existed, and left a stale clash badge on the timeline.
      conflictEventId: null,
      conflictSeverity: null,
    },
  });

  if (current.reminderId)
    await db.reminder.updateMany({
      where: { id: current.reminderId },
      data: {
        slotId: current.id,
        status: "slotted",
        estimatedMinutes: Math.ceil((params.endsAt - params.startsAt) / 60_000),
      },
    });
  await recordSlotEvent(
    db,
    {
      slotId: params.slotId,
      type: params.actor === "system" ? "auto_moved" : "user_moved",
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
    actor: SlotActor;
    reasonCode?: string;
    reasonText?: string;
    /** Stable client action id: status and deduplication commit together. */
    actionId?: string;
    /** Where it was, and where we would have put it. Only the bucket fills
     *  these in: a suggestion the user has not answered yet is a position, and
     *  the log is where a position with no slot to sit on lives. */
    fromStartsAt?: number;
    toStartsAt?: number;
  },
  now: number,
  newId: () => string,
): Promise<void> {
  if (!isTransaction(db))
    return userTransaction(db, (tx) => setSlotStatus(tx, params, now, newId));
  if (params.actionId) {
    const fingerprint = JSON.stringify([
      params.slotId,
      params.status,
      params.actor,
      params.reasonCode ?? null,
      params.reasonText ?? null,
    ]);
    const existing = await db.$queryRawUnsafe<{ fingerprint: string }[]>(
      "SELECT fingerprint FROM _slot_actions WHERE id = ?",
      params.actionId,
    );
    if (existing[0]) {
      if (existing[0].fingerprint !== fingerprint)
        throw new ActionConflict(
          "Action id already used for a different action",
        );
      return;
    }
    await db.$executeRawUnsafe(
      "INSERT INTO _slot_actions (id, slot_id, fingerprint) VALUES (?, ?, ?)",
      params.actionId,
      params.slotId,
      fingerprint,
    );
  }
  const slot = await getSlot(db, params.slotId);
  if (!slot) throw new ActionConflict("Slot no longer exists");
  if (slot.status === "completed" && params.status !== "completed")
    throw new ActionConflict("Completed history cannot be changed");
  // A repeated Start must not reset the stop window, even with a new action id.
  if (slot.status === "started" && params.status === "started") return;
  if (slot.status === "started" && params.actor !== "system") {
    if (["cancelled", "bucketed", "planned", "live"].includes(params.status))
      throw new ActionConflict(
        "A started slot cannot be moved or removed. Stop it first while the stop window is open.",
      );
    // After its scheduled end, the existing recovery action can still record
    // that it didn't happen. That is history, not stopping a running session.
    if (params.status === "skipped" && now < slot.endsAt) {
      const starts = await slotStartTimes(db, [slot.id]);
      if (
        !canStopSlot({ ...slot, startedAt: starts.get(slot.id) ?? null }, now)
      )
        throw new ActionConflict(
          "The stop window has closed. You can create another slot instead.",
        );
    }
  }
  if (
    params.status === "started" &&
    params.actor !== "system" &&
    !canStartSlot(slot, now)
  )
    throw new ActionConflict(
      "This slot can no longer be started or resumed. You can still mark it done.",
    );
  if (params.status === "started" && slot.reminderId) {
    const todo = await db.reminder.findUnique({
      where: { id: slot.reminderId },
    });
    if (todo?.status === "done" || (todo?.slotId && todo.slotId !== slot.id))
      throw new ActionConflict(
        "This todo is already done or has a newer appointment",
      );
    // An early Stop detaches the todo. Resume still belongs to this slot.
    await db.reminder.updateMany({
      where: { id: slot.reminderId, slotId: null, status: "open" },
      data: { slotId: slot.id },
    });
  }
  if (
    params.status === "started" &&
    ["completed", "cancelled", "missed", "bucketed"].includes(slot.status)
  )
    throw new ActionConflict("This slot cannot be started");
  await db.slot.updateMany({
    where: { id: params.slotId },
    data: { status: params.status },
  });
  // An old offline action must never finish or reopen a newer appointment.
  if (slot.reminderId) {
    const status =
      params.status === "completed"
        ? "done"
        : ["cancelled", "skipped", "missed", "bucketed"].includes(params.status)
          ? "open"
          : "slotted";
    await db.reminder.updateMany({
      where: { id: slot.reminderId, slotId: slot.id },
      data: {
        status,
        slotId: ["cancelled", "skipped", "missed"].includes(params.status)
          ? null
          : slot.id,
      },
    });
  }

  const typeByStatus: Partial<Record<SlotStatus, SlotEventType>> = {
    started: "started",
    completed: "completed",
    skipped: "skipped",
    missed: "missed",
    cancelled: "cancelled",
    bucketed: "bucketed",
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
      ...(params.fromStartsAt !== undefined
        ? { fromStartsAt: params.fromStartsAt }
        : {}),
      ...(params.toStartsAt !== undefined
        ? { toStartsAt: params.toStartsAt }
        : {}),
    },
    now,
    newId,
  );
}

/**
 * The bucket: sessions the day no longer has room for.
 *
 * Ranged like `listMissed`, and for the same reason - the bucket is a thing
 * about today, and yesterday's is history rather than a backlog. Nothing here
 * empties it: a session stays until the user gives it a time or drops it, and
 * freed time is never quietly claimed.
 *
 * Filed by the time it *was* due, which is what makes it sortable and is also
 * the only honest thing to call a session with no place left.
 */
export async function listBucket(
  db: UserDatabase,
  from?: number,
  to?: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: {
      ...(from !== undefined && to !== undefined
        ? { startsAt: { gte: at(from), lt: at(to) } }
        : {}),
      status: "bucketed",
    },
    orderBy: { startsAt: "asc" },
  });
  return rows.map(toSlot);
}

/** Routine shortfalls belong to a day, unlike explicitly saved one-off work. */
export async function listBucketForDay(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: {
      status: "bucketed",
      OR: [
        { activityId: null },
        { reminderId: { not: null } },
        { startsAt: { gte: at(from), lt: at(to) } },
      ],
    },
    orderBy: { startsAt: "asc" },
  });
  return rows.map(toSlot);
}

export function expiredRoutineBucket(
  slot: SlotRow,
  now: number,
  zone = slot.timeZone,
): boolean {
  return (
    slot.status === "bucketed" &&
    slot.activityId !== null &&
    slot.reminderId === null &&
    slot.startsAt < dayBounds(localDateOf(now, zone), zone, 0, 1440).start
  );
}

/**
 * Slots whose grace period has run out, inside this user's database.
 *
 * The cron ticker no longer scans every user - it reads the directory's
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
    where: { startsAt: { lt: at(range.to) }, endsAt: { gt: at(range.from) } },
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

/**
 * A slot due for a decision, with the two activity fields that make it.
 *
 * The policy and the grace both live on the activity, and the sweep needs them
 * per slot rather than as one number for everyone - a five-minute eye rest
 * that starts itself and a twenty-five minute focus block you have to commit
 * to are the same row with different answers to these two questions.
 */
export interface DueSlot extends SlotRow {
  /** "manual" | "auto" | "prompt". Manual for a slot with no activity behind
   *  it, which is the behaviour that existed before policies did. */
  startPolicy: string;
  graceMinutes: number;
  bufferBeforeMeetingMinutes: number;
}

export async function slotsPastGrace(
  db: UserDatabase,
  now: number,
  limit: number,
  /**
   * How far back to look.
   *
   * Without it the sweep matched every planned slot ever, however old. A slot
   * that started this morning is not "just past its grace period": moving it
   * five minutes on says nothing, and doing that twice buries it in the missed
   * list. The auto-move is for a slot whose moment is passing right now;
   * anything older has already been missed, and saying so is the missed list's
   * job rather than this one's.
   */
  window: number,
): Promise<DueSlot[]> {
  const rows = await db.slot.findMany({
    where: {
      status: "planned",
      startsAt: { lte: at(now), gt: at(now - window) },
    },
    // The policy decides what a locked slot gets, so the lock can no longer be
    // a filter here: a hand-placed eye rest still has to start itself, it just
    // must never be moved. See `sweepGrace`.
    include: {
      activity: {
        select: {
          startPolicy: true,
          graceMinutes: true,
          bufferBeforeMeetingMinutes: true,
        },
      },
    },
    orderBy: { startsAt: "asc" },
    take: limit,
  });

  return rows.map(({ activity, ...row }) => ({
    ...toSlot(row),
    startPolicy: activity?.startPolicy ?? "manual",
    graceMinutes: activity?.graceMinutes ?? 0,
    bufferBeforeMeetingMinutes: activity?.bufferBeforeMeetingMinutes ?? 0,
  }));
}

/**
 * Slots that have run their length and are waiting to be closed for the user.
 *
 * Only ever `auto` ones. A manual session is finished by the person doing it -
 * the stepper's last screen is part of the activity, not paperwork after it -
 * and closing those here would mark a stretch complete that nobody did.
 */
export async function autoSlotsToComplete(
  db: UserDatabase,
  now: number,
  limit: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: {
      status: "started",
      endsAt: { lte: at(now) },
      activity: { startPolicy: "auto" },
    },
    orderBy: { endsAt: "asc" },
    take: limit,
  });
  return rows.map(toSlot);
}

/**
 * Sessions that were started by hand and never finished.
 *
 * `started` is the one status with nothing behind it. An `auto` slot is closed
 * at its end by the query above; a manual one is closed by the person doing
 * it, from inside the session - and if the window is shut, the app quit or the
 * machine sleeps, nobody ever closes it. The row then stays `started` for
 * ever: still "running now" a week later, still counted as scheduled by
 * `scheduledForRange`, so the day never asks for the session again either.
 *
 * The grace is long on purpose. A session that ran over, or a laptop lid shut
 * for ten minutes mid-stretch, is someone still doing the activity, and this
 * must not close a session out from under them. An hour past the end is not
 * that.
 *
 * Any policy, deliberately: run this after `autoSlotsToComplete` and the
 * `auto` ones are already gone, so what is left really is abandoned.
 */
export async function abandonedSlots(
  db: UserDatabase,
  now: number,
  limit: number,
  grace: number,
): Promise<SlotRow[]> {
  const rows = await db.slot.findMany({
    where: { status: "started", endsAt: { lte: at(now - grace) } },
    orderBy: { endsAt: "asc" },
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
  const rows = await db.slot.findMany({
    where: {
      OR: [
        { status: "planned", startsAt: { gt: at(after - 30 * 60_000) } },
        { status: "started" },
      ],
    },
    include: {
      activity: { select: { startPolicy: true, graceMinutes: true } },
    },
  });
  const deadlines = rows.flatMap((row) => {
    const auto = row.activity?.startPolicy === "auto";
    if (row.status === "started")
      return [ms(row.endsAt) + (auto ? 0 : 60 * 60_000)];
    if (!auto && row.isLocked) return [];
    return [
      ms(row.startsAt) +
        (auto ? 0 : (row.activity?.graceMinutes ?? 0) * 60_000),
    ];
  });
  return deadlines.length ? Math.min(...deadlines) : undefined;
}

/** Progress so far, for the solver's demand calculation. */
/**
 * How many sessions of each activity are already on the day but not yet done.
 *
 * The counterpart to `progressForRange`, which counts only what was completed.
 * "Two stretches left today" has to mean two that are neither done *nor
 * already sitting on the timeline* - counting only completions would leave the
 * placement tray asking for three more the moment three were placed.
 */
/** Explicit "not today" choices consume demand, but pauses/archives do not.
 * Inspect the last cancellation, so an earlier Undo cannot mask a later pause. */
export async function userDismissedSlots(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<{ id: string; activityId: string | null }[]> {
  const rows = await db.slot.findMany({
    where: { status: "cancelled", startsAt: { gte: at(from), lt: at(to) } },
    select: {
      id: true,
      activityId: true,
      events: {
        where: { type: "cancelled" },
        orderBy: { at: "desc" },
        take: 1,
        select: { reasonCode: true },
      },
    },
  });
  return rows.filter((row) => row.events[0]?.reasonCode === "user_choice");
}

export async function scheduledForRange(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<Map<string, number>> {
  const rows = await db.slot.findMany({
    where: {
      startsAt: { gte: at(from), lt: at(to) },
      // Accounted-for occurrences, including unused attempts and today's
      // saved shortfalls, must not also appear as fresh Not placed demand.
      status: {
        in: ["planned", "live", "started", "bucketed", "skipped", "missed"],
      },
    },
    select: { activityId: true },
  });

  const byActivity = new Map<string, number>();
  for (const row of [...rows, ...(await userDismissedSlots(db, from, to))]) {
    if (!row.activityId) continue;
    byActivity.set(row.activityId, (byActivity.get(row.activityId) ?? 0) + 1);
  }
  return byActivity;
}

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

/** Latest actual Start per slot, from the durable lifecycle log (also on reload). */
export async function slotStartTimes(
  db: UserDatabase,
  slotIds: readonly string[],
): Promise<Map<string, number>> {
  if (slotIds.length === 0) return new Map();
  const rows = await db.slotEvent.findMany({
    where: { slotId: { in: [...slotIds] }, type: "started" },
    select: { slotId: true, at: true },
    orderBy: { at: "asc" },
  });
  return new Map(rows.map((row) => [row.slotId, ms(row.at)]));
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
