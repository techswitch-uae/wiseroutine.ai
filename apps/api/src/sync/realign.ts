import {
  type Directory,
  listActivities,
  listEventsInRange,
  listSlotsForRange,
  markConflicts,
  moveSlot,
  scheduleWork,
  setSlotStatus,
  type UserDatabase,
} from "@wiseroutine/db";
import { can, type PlanId } from "@wiseroutine/plans";
import { dayBounds, localDateOf, toBusyBlocks } from "@wiseroutine/scheduler";
import { detectConflicts, type PlannerUser } from "../planning/planDay";
import { repair } from "../planning/repair";

/**
 * What happens once a change has actually been detected.
 *
 * Syncing writes the new state of someone's calendar and stops there. Until
 * this ran, a meeting dragged onto a focus slot in Outlook was stored
 * faithfully and changed nothing: the slot sat underneath it, and the person
 * found out by looking.
 *
 * Two things happen here, and only one of them is a paid feature. Marking the
 * conflict is not - a slot the app knows is buried must say so on every plan,
 * because a timeline that quietly lies is worse than one that says "this
 * clashes". *Repairing* the day is `plan.adaptive`, which is pro.
 *
 * It repairs rather than replans. This used to call `planDay`, which wipes
 * every planned slot from `now` onward and re-solves the day - correct, and
 * unusable: a meeting that moved twenty minutes made four blocks the user had
 * already accepted jump somewhere else, with no honest way to explain any of
 * them. `rearrange` touches only the slots the change actually broke, and
 * every move has one meeting behind it. See docs/rearrangement.md.
 */

export interface RealignDeps {
  db: UserDatabase;
  directory: Directory;
  userId: string;
  plan: PlanId;
  user: PlannerUser;
}

export interface RealignOutcome {
  conflicts: number;
  moved: number;
  /** Sessions handed back to the user because the day had no room we would
   *  stand behind - suggestions included. */
  bucketed: number;
}

/**
 * Scoped to the local day the sync landed in.
 *
 * A meeting that moved three weeks out matters when that morning's plan runs,
 * not now - and re-planning every day inside the sync window would turn one
 * webhook into sixty days of solver work.
 */
export async function realignAfterSync(
  deps: RealignDeps,
  now: number,
  newId: () => string,
): Promise<RealignOutcome> {
  const zone = deps.user.timeZone;
  const date = localDateOf(now, zone);
  // Two windows, and they are not the same. Everything is *read* over the whole
  // local day, because a meeting that starts before working hours still eats
  // the top of them; nothing is *placed* outside the day the user works.
  const whole = dayBounds(date, zone, 0, 24 * 60);
  const working = dayBounds(
    date,
    zone,
    deps.user.dayStartMinutes,
    deps.user.dayEndMinutes,
  );

  const conflicts = await detectConflicts(deps.db, whole.start, whole.end);

  await markConflicts(
    deps.db,
    { from: whole.start, to: whole.end },
    conflicts.map((x) => ({
      slotId: x.slotId,
      eventId: x.eventId,
      severity: x.severity,
    })),
  );

  /**
   * No edge tolerance any more.
   *
   * This used to ignore an overlap under five minutes, on the grounds that it
   * was not worth moving someone's day for. It is: a meeting that runs four
   * minutes into a stretch has taken four minutes of it, and the app said
   * everything was fine while a meeting ate the top of a session. Any overlap
   * is a conflict, and the engine decides what it is worth - which for a small
   * one is usually a small move.
   */
  if (conflicts.length === 0) return { conflicts: 0, moved: 0, bucketed: 0 };

  // Free plans see the conflict and decide themselves. This is the same gate
  // `POST /plan` applies to a `calendar_change` trigger - checked here too,
  // because a push notification must not become a way around it.
  if (!can(deps.plan, { kind: "plan.adaptive" }).ok) {
    return { conflicts: conflicts.length, moved: 0, bucketed: 0 };
  }

  const [events, activities, slots] = await Promise.all([
    listEventsInRange(deps.db, whole.start, whole.end),
    listActivities(deps.db),
    listSlotsForRange(deps.db, whole.start, whole.end),
  ]);

  const plan = repair({
    now,
    dayStart: working.start,
    dayEnd: working.end,
    // The inferring reading, the same one `planDay` places on. The literal one
    // the corpus runs is a product decision that belongs to both engines at
    // once - two solvers disagreeing about what counts as busy is worse than
    // either answer. See docs/rearrangement.md, "What counts as busy".
    busy: toBusyBlocks(events),
    slots,
    activities,
  });

  for (const move of plan.moves) {
    await moveSlot(
      deps.db,
      {
        slotId: move.slotId,
        startsAt: move.startsAt,
        endsAt: move.endsAt,
        actor: "system",
        reasonCode: "calendar_change",
      },
      now,
      newId,
    );
  }

  for (const entry of plan.bucket) {
    await setSlotStatus(
      deps.db,
      {
        slotId: entry.slotId,
        status: "bucketed",
        actor: "system",
        reasonCode: entry.reason,
        fromStartsAt: entry.fromStartsAt,
        // Present only for a suggestion. A bucket row with a `toStartsAt` is a
        // question with an answer attached; one without is a dead end.
        ...(entry.toStartsAt !== undefined
          ? { toStartsAt: entry.toStartsAt }
          : {}),
      },
      now,
      newId,
    );
  }

  // A moved slot carries a fresh grace period, and the sweep that enforces it
  // is driven from the directory - so a repair that does not leave a marker
  // there is a repair whose slots never expire.
  if (plan.moves.length > 0) {
    await scheduleWork(
      deps.directory,
      { userId: deps.userId, kind: "grace_sweep", dueAt: now + 60_000 },
      now,
      newId,
    );
  }

  return {
    conflicts: conflicts.length,
    moved: plan.moves.length,
    bucketed: plan.bucket.length,
  };
}
