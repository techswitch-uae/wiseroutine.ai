import type { CalendarEvent } from "@wiseroutine/scheduler";
import { at, atOrNull, ms, type UserDatabase } from "../client";

export interface NormalisedEvent {
  providerEventId: string;
  icalUid?: string | null;
  seriesMasterId?: string | null;
  title?: string | null;
  startsAt: number;
  endsAt: number;
  timeZone?: string | null;
  isAllDay: boolean;
  kind: CalendarEvent["kind"];
  busyStatus: CalendarEvent["busyStatus"];
  responseStatus: CalendarEvent["responseStatus"];
  isCancelled: boolean;
  changeTag?: string | null;
  providerUpdatedAt?: number | null;
  joinUrl?: string | null;
}

/**
 * A stored event, as everything above the database wants it.
 *
 * `CalendarEvent` is the scheduler's, and the solver has no use for a join
 * link - so rather than push a screen's field into a type that exists to be
 * free of them, the extra travels alongside.
 */
export type StoredEvent = CalendarEvent & { joinUrl: string | null };

export interface UpsertResult {
  written: number;
  skipped: number;
}

/**
 * Write only what actually changed.
 *
 * A blind re-upsert of every event on every sync is the difference between a
 * near-free bill and a large one - the provider's own `etag`/`changeKey` tells
 * us when a write would be a no-op, so we skip it.
 */
export async function upsertEvents(
  db: UserDatabase,
  params: { calendarId: string; storeTitles: boolean },
  events: readonly NormalisedEvent[],
  now: number,
  newId: () => string,
): Promise<UpsertResult> {
  if (events.length === 0) return { written: 0, skipped: 0 };

  const existing = await db.externalEvent.findMany({
    where: { calendarId: params.calendarId },
    select: { providerEventId: true, changeTag: true },
  });

  const tagById = new Map(
    existing.map((e) => [e.providerEventId, e.changeTag]),
  );
  let written = 0;
  let skipped = 0;

  for (const event of events) {
    const knownTag = tagById.get(event.providerEventId);
    if (
      knownTag !== undefined &&
      knownTag !== null &&
      knownTag === event.changeTag
    ) {
      skipped++;
      continue;
    }

    const data = {
      calendarId: params.calendarId,
      providerEventId: event.providerEventId,
      icalUid: event.icalUid ?? null,
      seriesMasterId: event.seriesMasterId ?? null,
      // Data minimisation: a user can opt out of storing titles entirely and
      // keep only busy intervals.
      title: params.storeTitles ? (event.title ?? null) : null,
      // Under the same opt-out as the title: a join link names the meeting's
      // host and its room, which is the thing someone turning titles off is
      // asking us not to keep.
      joinUrl: params.storeTitles ? (event.joinUrl ?? null) : null,
      startsAt: at(event.startsAt),
      endsAt: at(event.endsAt),
      timeZone: event.timeZone ?? null,
      isAllDay: event.isAllDay,
      kind: event.kind,
      busyStatus: event.busyStatus,
      responseStatus: event.responseStatus,
      isCancelled: event.isCancelled,
      changeTag: event.changeTag ?? null,
      providerUpdatedAt: atOrNull(event.providerUpdatedAt),
      // Cancellations are tombstoned, never deleted, so the UI can explain that
      // a conflict disappeared because the meeting was called off.
      deletedAt: event.isCancelled ? at(now) : null,
      updatedAt: at(now),
    };

    await db.externalEvent.upsert({
      where: {
        calendarId_providerEventId: {
          calendarId: params.calendarId,
          providerEventId: event.providerEventId,
        },
      },
      update: data,
      create: { id: newId(), ...data },
    });
    written++;
  }

  return { written, skipped };
}

/** Graph tombstones carry only an id, so deletion must work from that alone. */
export async function tombstoneEvents(
  db: UserDatabase,
  calendarId: string,
  providerEventIds: readonly string[],
  now: number,
): Promise<void> {
  if (providerEventIds.length === 0) return;

  await db.externalEvent.updateMany({
    where: { calendarId, providerEventId: { in: [...providerEventIds] } },
    data: { isCancelled: true, deletedAt: at(now), updatedAt: at(now) },
  });
}

/**
 * Everything still live in a window, ready to be turned into busy blocks.
 *
 * Filtered by the calendar's own selection, not just by what has been synced.
 * Deselecting a calendar cancels its future syncs but leaves everything
 * already fetched sitting in the table, so without this the events kept
 * showing on the day - and, worse, kept blocking the planner - until someone
 * deleted them by hand. Reading through the relation makes the toggle take
 * effect at once, and makes re-selecting free: the rows never went anywhere.
 */
export async function listEventsInRange(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<StoredEvent[]> {
  const rows = await db.externalEvent.findMany({
    where: {
      deletedAt: null,
      startsAt: { lt: at(to) },
      endsAt: { gte: at(from) },
      calendar: { isSelected: true },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    calendarId: row.calendarId,
    icalUid: row.icalUid ?? undefined,
    title: row.title ?? undefined,
    start: ms(row.startsAt),
    end: ms(row.endsAt),
    isAllDay: row.isAllDay,
    kind: row.kind as CalendarEvent["kind"],
    busyStatus: row.busyStatus as CalendarEvent["busyStatus"],
    responseStatus: row.responseStatus as CalendarEvent["responseStatus"],
    isCancelled: row.isCancelled,
    joinUrl: row.joinUrl ?? null,
  }));
}

/** Age out events past the retention window so a user's database does not grow
 *  forever. */
export async function pruneEventsBefore(
  db: UserDatabase,
  before: number,
): Promise<void> {
  await db.externalEvent.deleteMany({ where: { endsAt: { lt: at(before) } } });
}

/** Turning titles off must also remove the ones already stored, or the setting
 *  is a promise we only keep going forward. */
export async function forgetStoredTitles(db: UserDatabase): Promise<void> {
  await db.externalEvent.updateMany({ data: { title: null } });
}
