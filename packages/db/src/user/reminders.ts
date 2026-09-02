import { at, ms, type UserDatabase } from "../client";

/**
 * Todos - the `reminders` table, which was waiting for exactly this.
 *
 * A todo has no time of its own. It is a title and, at most, a length: the
 * moment it is put on the day it becomes a slot, and the todo is marked
 * `slotted` and points at it. Everything about *when* lives on the slot.
 *
 * ponytail: `dueWindow` is a required column nobody writes yet, so it holds
 * "none". Give it a meaning when a due date is drawn.
 */

export type ReminderStatus = "open" | "slotted" | "done" | "dropped";

export interface ReminderRow {
  id: string;
  title: string;
  /** How long it needs, or null for "no idea yet". */
  estimatedMinutes: number | null;
  needsFocus: boolean;
  status: ReminderStatus;
  slotId: string | null;
  createdAt: number;
}

const toRow = (row: {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  needsFocus: boolean;
  status: string;
  slotId: string | null;
  createdAt: Date;
}): ReminderRow => ({
  id: row.id,
  title: row.title,
  estimatedMinutes: row.estimatedMinutes,
  needsFocus: row.needsFocus,
  status: row.status as ReminderStatus,
  slotId: row.slotId,
  createdAt: ms(row.createdAt),
});

/** The ones still waiting, oldest first - the order they were thought of. */
export async function listOpenReminders(
  db: UserDatabase,
): Promise<ReminderRow[]> {
  const rows = await db.reminder.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRow);
}

export async function getReminder(
  db: UserDatabase,
  id: string,
): Promise<ReminderRow | null> {
  const row = await db.reminder.findUnique({ where: { id } });
  return row ? toRow(row) : null;
}

export async function createReminder(
  db: UserDatabase,
  input: {
    title: string;
    estimatedMinutes?: number | null;
    needsFocus?: boolean;
  },
  now: number,
  newId: () => string,
): Promise<ReminderRow> {
  const row = await db.reminder.create({
    data: {
      id: newId(),
      title: input.title,
      dueWindow: "none",
      estimatedMinutes: input.estimatedMinutes ?? null,
      needsFocus: input.needsFocus ?? false,
      status: "open",
      createdAt: at(now),
    },
  });
  return toRow(row);
}

export async function setReminderStatus(
  db: UserDatabase,
  id: string,
  status: ReminderStatus,
  slotId: string | null = null,
): Promise<void> {
  await db.reminder.update({ where: { id }, data: { status, slotId } });
}
