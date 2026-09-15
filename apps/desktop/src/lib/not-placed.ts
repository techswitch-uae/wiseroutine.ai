import type { ActivityProgress, BucketItem } from "./api";
import { owedToday } from "./owed";

export interface NotPlacedRow {
  key: string;
  activityId: string;
  /** Saved occurrences are placed before creating any outstanding demand. */
  slotId?: string;
  name: string;
  kind: "recovery" | "focus" | "task";
  minutes: number;
  count: number;
}

/** Scheduled progress already includes saved unplaced occurrences. Add only
 * genuinely unmaterialized demand, then group equal-duration slots together. */
export function notPlacedRows(
  progress: readonly ActivityProgress[],
  saved: readonly BucketItem[],
): NotPlacedRow[] {
  const rows = new Map<string, NotPlacedRow>();
  for (const slot of saved) {
    const minutes = (slot.endsAt - slot.startsAt) / 60_000;
    const key = JSON.stringify([
      slot.activityId ?? slot.id,
      minutes,
      slot.kind,
    ]);
    const row = rows.get(key);
    if (row) row.count++;
    else
      rows.set(key, {
        key,
        activityId: slot.activityId ?? "",
        slotId: slot.id,
        name: slot.title,
        kind: slot.kind,
        minutes,
        count: 1,
      });
  }
  for (const owed of owedToday(progress)) {
    const key = JSON.stringify([owed.id, owed.minutes, owed.kind]);
    const row = rows.get(key);
    if (row) row.count += owed.left;
    else
      rows.set(key, {
        key,
        activityId: owed.id,
        name: owed.name,
        kind: owed.kind,
        minutes: owed.minutes,
        count: owed.left,
      });
  }
  return [...rows.values()];
}
