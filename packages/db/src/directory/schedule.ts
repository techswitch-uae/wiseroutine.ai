import { at, type Directory, ms } from "../client";

/**
 * The coordination table.
 *
 * With one database per user there is no way to ask "whose calendar is due?" or
 * "whose slot has run out of grace?" - on a shared database those were single
 * indexed scans. So the *timing* is denormalised here while the authoritative
 * state stays in the user's own database. The cron ticker reads one table and
 * fans out; the queue consumer opens the user's database and does the work.
 *
 * The cost of this design is that both must be kept in step: whenever a sync
 * completes or a slot changes, the matching row here is rescheduled. Anything
 * that writes user state and forgets to touch this table goes quiet.
 */
export type WorkKind = "sync_calendar" | "renew_watch" | "grace_sweep";

export interface DueWork {
  id: string;
  userId: string;
  kind: WorkKind;
  /** Empty string means the work is not scoped to one row. */
  targetId: string;
  dueAt: number;
  failures: number;
}

export async function scheduleWork(
  directory: Directory,
  input: {
    userId: string;
    kind: WorkKind;
    targetId?: string;
    dueAt: number;
  },
  now: number,
  newId: () => string,
): Promise<void> {
  const targetId = input.targetId ?? "";

  await directory.scheduledWork.upsert({
    where: {
      userId_kind_targetId: {
        userId: input.userId,
        kind: input.kind,
        targetId,
      },
    },
    update: { dueAt: at(input.dueAt), backoffUntil: null, failures: 0 },
    create: {
      id: newId(),
      userId: input.userId,
      kind: input.kind,
      targetId,
      dueAt: at(input.dueAt),
      createdAt: at(now),
    },
  });
}

/**
 * What is due right now, across every user.
 *
 * The one query the cron ticker makes. Ordered by `dueAt` so the longest
 * overdue work goes first and nothing starves.
 */
export async function dueWork(
  directory: Directory,
  now: number,
  limit: number,
): Promise<DueWork[]> {
  const rows = await directory.scheduledWork.findMany({
    where: {
      dueAt: { lte: at(now) },
      OR: [{ backoffUntil: null }, { backoffUntil: { lte: at(now) } }],
      user: { deletedAt: null, databaseReady: true },
    },
    orderBy: { dueAt: "asc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    kind: row.kind as WorkKind,
    targetId: row.targetId,
    dueAt: ms(row.dueAt),
    failures: row.failures,
  }));
}

export async function completeWork(
  directory: Directory,
  id: string,
  nextDueAt: number,
): Promise<void> {
  await directory.scheduledWork.update({
    where: { id },
    data: { dueAt: at(nextDueAt), backoffUntil: null, failures: 0 },
  });
}

/** Exponential backoff with a ceiling, recorded so a failing calendar is
 *  visible rather than silently quiet. */
export async function failWork(
  directory: Directory,
  id: string,
  now: number,
): Promise<number> {
  const current = await directory.scheduledWork.findUnique({
    where: { id },
    select: { failures: true },
  });
  const failures = (current?.failures ?? 0) + 1;
  const delay = Math.min(2 ** failures * 60_000, 6 * 60 * 60_000);

  await directory.scheduledWork.update({
    where: { id },
    data: { failures, backoffUntil: at(now + delay), dueAt: at(now + delay) },
  });

  return failures;
}

export async function cancelWork(
  directory: Directory,
  userId: string,
  kind: WorkKind,
  targetId = "",
): Promise<void> {
  await directory.scheduledWork.deleteMany({
    where: { userId, kind, targetId },
  });
}

/** Used when a user is deleted, so nothing keeps polling a database that is
 *  about to disappear. */
export async function cancelAllWork(
  directory: Directory,
  userId: string,
): Promise<void> {
  await directory.scheduledWork.deleteMany({ where: { userId } });
}
