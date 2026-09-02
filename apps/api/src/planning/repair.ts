import {
  type ActivityWithWindows,
  type SlotRow,
  toSchedulerActivity,
} from "@wiseroutine/db";
import {
  ANYWHERE,
  type BusyBlock,
  type CurrentSlot,
  rearrange,
} from "@wiseroutine/scheduler";

/**
 * The decision half of `realignAfterSync`: rows in, writes out, no I/O.
 *
 * All this does is put the day into the shape `rearrange` reads and turn its
 * three outcomes into the two things a database can hold - a slot that moved,
 * and a slot in the bucket. The placement rules are the engine's and are
 * tested there (see docs/rearrangement.md); what is worth testing here is only
 * that a `suggested` does not get applied behind the user's back and that a
 * `blocked` does not quietly vanish.
 *
 * `moved` is applied. `suggested` and `blocked` both go to the bucket, which
 * is the answer to "fit it, or hand it back": a suggestion arrives there
 * carrying the position we would have used, and a block arrives with nothing
 * but the reason. One list, one place to look, two kinds of row.
 */

export interface RepairInput {
  now: number;
  /** The user's working day. Nothing is placed outside it. */
  dayStart: number;
  dayEnd: number;
  /** Busy blocks *after* the calendar change. */
  busy: BusyBlock[];
  /** Every slot on the local day, whatever its status. */
  slots: readonly SlotRow[];
  activities: readonly ActivityWithWindows[];
}

export interface RepairMove {
  slotId: string;
  startsAt: number;
  endsAt: number;
}

export interface RepairBucketed {
  slotId: string;
  /** The engine's reason, verbatim. Comma-joined when a suggestion had more
   *  than one, because dropping the second at the storage boundary is the kind
   *  of loss nobody ever notices. */
  reason: string;
  fromStartsAt: number;
  /** Where we would have put it, or absent when there was nowhere at all.
   *  This is what separates a question from a dead end in the bucket. */
  toStartsAt?: number;
}

export interface Repair {
  moves: RepairMove[];
  bucket: RepairBucketed[];
  /** Slots that clash and are no longer ours to move - running, or already
   *  begun by the clock. Reported so the conflict badge stays honest. */
  frozen: string[];
}

export function repair(input: RepairInput): Repair {
  const result = rearrange({
    now: input.now,
    dayStart: input.dayStart,
    dayEnd: input.dayEnd,
    busy: input.busy,
    slots: input.slots
      // Already in the bucket, so it holds no time: it neither moves nor
      // stands in the way of something that does.
      .filter((s) => s.status !== "bucketed")
      .map((s) => ({
        id: s.id,
        // A slot with no activity has no rules to reason with. Keying it by
        // its own id leaves it absent from `activities` below, which is how
        // the engine is told to leave it exactly alone.
        activityId: s.activityId ?? s.id,
        // Safe past the filter above: the two unions differ only by the
        // status it removed.
        status: s.status as CurrentSlot["status"],
        start: s.startsAt,
        end: s.endsAt,
      })),
    /**
     * Every activity is placeable anywhere, for now.
     *
     * `activity_windows` stores an `anchor_minutes` point, not a region, and
     * there is no `spread` column - so a window here would be one this file
     * invented rather than one the user set, and it would be *stricter* than
     * `planDay`, which reads the same anchors as a soft preference. Until the
     * schema can express a region, "no stated preference" is the honest
     * reading, and drift is what decides. See docs/rearrangement.md,
     * "Follow-ups".
     */
    activities: Object.fromEntries(
      input.activities.map(({ row }) => [
        row.id,
        { activity: toSchedulerActivity(row), policy: ANYWHERE },
      ]),
    ),
  });

  return {
    moves: result.moved.map((m) => ({
      slotId: m.slotId,
      startsAt: m.to.start,
      endsAt: m.to.end,
    })),
    bucket: [
      ...result.suggested.map((s) => ({
        slotId: s.slotId,
        reason: s.reasons.join(","),
        fromStartsAt: s.from.start,
        toStartsAt: s.to.start,
      })),
      ...result.blocked.map((b) => ({
        slotId: b.slotId,
        reason: b.reason,
        fromStartsAt: b.from.start,
      })),
    ].sort((a, b) => a.fromStartsAt - b.fromStartsAt),
    frozen: result.frozenConflicts,
  };
}
