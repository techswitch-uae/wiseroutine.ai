/**
 * What today still owes, per activity.
 *
 * Beside the placement sheet rather than inside it because it is a fact about
 * the day, not about a piece of UI: the tray, the sheet and anything that
 * later wants to say "two stretches left" all need the same answer.
 */

import type { ActivityProgress } from "./api";

/** What the day still owes, per activity, for the tray above the timeline. */
export interface Owed {
  id: string;
  name: string;
  /** What it is drawn as while it is being dragged onto the day. */
  kind: "recovery" | "focus" | "task";
  /** Sessions left today. Always at least one, or it would not be here. */
  left: number;
  /** Sessions the day asked for. "2 of 3" reads as progress; "2" alone reads
   *  as a demand with no end to it. */
  of: number;
  minutes: number;
}

/**
 * How much of each per-day minimum is still outstanding.
 *
 * Derived from the same `progress` rows the "Today so far" module draws, so
 * the tray and the module can never disagree about whether something is done.
 * Duration minimums are turned into whole sessions, rounded up: forty minutes
 * left of a two-hour target with 25-minute blocks is two more blocks, not 1.6.
 */
export function owedToday(progress: readonly ActivityProgress[]): Owed[] {
  return progress
    .map((row) => {
      const minutes = row.sessionMinutes;
      // Done *and* already placed both count against the minimum. Counting
      // only completions would leave the tray asking for three more stretches
      // the moment three were put on the afternoon.
      const placed = row.scheduled ?? 0;
      const of =
        row.minimumType === "durationPerDay"
          ? Math.ceil(row.minimumValue / (minutes || 1))
          : row.minimumValue;
      const left =
        row.minimumType === "durationPerDay"
          ? Math.ceil(
              Math.max(0, row.minimumValue - row.minutes) / (minutes || 1),
            ) - placed
          : row.minimumValue - row.count - placed;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        left: Math.max(0, left),
        of,
        minutes,
      };
    })
    .filter((row) => row.left > 0);
}
