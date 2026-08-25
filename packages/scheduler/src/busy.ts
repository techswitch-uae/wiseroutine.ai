import type { BusyBlock, CalendarEvent, Interval } from "./types";

export interface BusyOptions {
  /** 3e leaves this to the user. Default matches the providers: tentative
   *  means the time is probably spoken for. */
  tentativeIsBusy?: boolean;
  /** All-day events are almost never real busy time. Override per calendar
   *  for the user who genuinely blocks whole days. */
  allDayIsBusy?: boolean;
}

/**
 * Whether an event actually occupies the user's time.
 *
 * This function decides whether the product works. Two failure modes:
 * counting something as busy that isn't leaves the user with no free time and
 * the app looks broken; counting something as free that isn't schedules a
 * stretch on top of a real meeting.
 */
export function isBusy(
  event: CalendarEvent,
  options: BusyOptions = {},
): boolean {
  const { tentativeIsBusy = true, allDayIsBusy = false } = options;

  if (event.isCancelled) return false;

  // Google's working-location events span the entire workday and are pure
  // metadata. Treating them as busy is THE bug that makes every user appear
  // to have zero free time, so it is checked before anything else.
  if (event.kind === "workingLocation") return false;
  if (event.kind === "birthday" || event.kind === "fromGmail") return false;

  // A meeting the user declined is not their time. Second most common cause
  // of phantom-busy after working locations.
  if (event.responseStatus === "declined") return false;

  if (event.busyStatus === "free") return false;

  const isOutOfOffice =
    event.kind === "outOfOffice" || event.busyStatus === "oof";

  // "Q3 planning week" or a birthday should not blank out five days. Only an
  // all-day out-of-office genuinely blocks the day.
  if (event.isAllDay && !isOutOfOffice && !allDayIsBusy) return false;

  if (
    event.busyStatus === "tentative" ||
    event.responseStatus === "tentative"
  ) {
    return tentativeIsBusy;
  }

  return true;
}

/** Merge overlapping and touching intervals into a minimal covering set. */
export function mergeIntervals<T extends Interval>(
  intervals: readonly T[],
): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const next of sorted) {
    const last = merged.at(-1);
    if (last && next.start <= last.end) {
      last.end = Math.max(last.end, next.end);
    } else {
      merged.push({ start: next.start, end: next.end });
    }
  }
  return merged;
}

/**
 * Turn raw calendar events into the canonical busy set.
 *
 * Order matters: filter, then deduplicate across calendars by iCalUID (users
 * routinely have the same meeting on both a work and a personal calendar),
 * then merge. Computing gaps per-calendar instead of against one merged set is
 * a classic source of slots placed inside meetings.
 */
export function toBusyBlocks(
  events: readonly CalendarEvent[],
  options: BusyOptions = {},
): BusyBlock[] {
  const kept = events.filter((e) => isBusy(e, options));

  const seenUids = new Set<string>();
  const deduped: CalendarEvent[] = [];
  for (const event of kept) {
    if (event.icalUid !== undefined) {
      if (seenUids.has(event.icalUid)) continue;
      seenUids.add(event.icalUid);
    }
    deduped.push(event);
  }

  // Merge, tracking which events produced each block so the UI can say which
  // meeting a slot collides with.
  const sorted = [...deduped]
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start);
  const blocks: BusyBlock[] = [];

  for (const event of sorted) {
    const last = blocks.at(-1);
    if (last && event.start <= last.end) {
      last.end = Math.max(last.end, event.end);
      last.sourceEventIds.push(event.id);
    } else {
      blocks.push({
        start: event.start,
        end: event.end,
        sourceEventIds: [event.id],
      });
    }
  }
  return blocks;
}

/** The complement of `busy` within `bounds` — the placeable gaps. */
export function freeGaps(
  bounds: Interval,
  busy: readonly Interval[],
): Interval[] {
  const gaps: Interval[] = [];
  let cursor = bounds.start;

  for (const block of mergeIntervals(busy)) {
    if (block.end <= bounds.start || block.start >= bounds.end) continue;
    if (block.start > cursor)
      gaps.push({ start: cursor, end: Math.min(block.start, bounds.end) });
    cursor = Math.max(cursor, block.end);
    if (cursor >= bounds.end) break;
  }
  if (cursor < bounds.end) gaps.push({ start: cursor, end: bounds.end });

  return gaps.filter((g) => g.end > g.start);
}

/** Does this slot overlap any busy block? Returns the first collision. */
export function findOverlap(
  slot: Interval,
  busy: readonly BusyBlock[],
): BusyBlock | undefined {
  return busy.find((b) => slot.start < b.end && b.start < slot.end);
}
