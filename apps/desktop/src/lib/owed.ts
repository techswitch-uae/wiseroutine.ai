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
  /** Sessions left today. Always at least one, or it would not be here. */
  left: number;
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
      const left =
        row.minimumType === "durationPerDay"
          ? Math.ceil(
              Math.max(0, row.minimumValue - row.minutes) / (minutes || 1),
            )
          : Math.max(0, row.minimumValue - row.count);
      return { id: row.id, name: row.name, left, minutes };
    })
    .filter((row) => row.left > 0);
}
