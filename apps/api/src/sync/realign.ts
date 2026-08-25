import {
  type Directory,
  markConflicts,
  scheduleWork,
  type UserDatabase,
} from "@wiseroutine/db";
import { can, type PlanId } from "@wiseroutine/plans";
import { dayBounds, localDateOf } from "@wiseroutine/scheduler";
import {
  detectConflicts,
  type PlannerUser,
  planDay,
} from "../planning/planDay";

/**
 * What happens once a change has actually been detected.
 *
 * Syncing writes the new state of someone's calendar and stops there. Until
 * this ran, a meeting dragged onto a focus slot in Outlook was stored
 * faithfully and changed nothing: the slot sat underneath it, and the person
 * found out by looking.
 *
 * Two things happen here, and only one of them is a paid feature. Marking the
 * conflict is not — a slot the app knows is buried must say so on every plan,
 * because a timeline that quietly lies is worse than one that says "this
 * clashes". *Moving* the slot is `plan.adaptive`, which is pro.
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
}

/**
 * Scoped to the local day the sync landed in.
 *
 * A meeting that moved three weeks out matters when that morning's plan runs,
 * not now — and re-planning every day inside the sync window would turn one
 * webhook into sixty days of solver work.
 */
export async function realignAfterSync(
  deps: RealignDeps,
  now: number,
  newId: () => string,
): Promise<RealignOutcome> {
  const zone = deps.user.timeZone;
  const bounds = dayBounds(localDateOf(now, zone), zone, 0, 24 * 60);

  const conflicts = await detectConflicts(deps.db, bounds.start, bounds.end);

  // Edge overlaps are recorded but never acted on: a meeting that runs five
  // minutes into a slot is not worth moving someone's day for.
  const actionable = conflicts.filter((x) => x.severity !== "edge");

  await markConflicts(
    deps.db,
    { from: bounds.start, to: bounds.end },
    conflicts.map((x) => ({
      slotId: x.slotId,
      eventId: x.eventId,
      severity: x.severity,
    })),
  );

  if (actionable.length === 0) return { conflicts: 0, moved: 0 };

  // Free plans see the conflict and decide themselves. This is the same gate
  // `POST /plan` applies to a `calendar_change` trigger — checked here too,
  // because a push notification must not become a way around it.
  if (!can(deps.plan, { kind: "plan.adaptive" }).ok) {
    return { conflicts: actionable.length, moved: 0 };
  }

  const result = await planDay(
    deps.db,
    {
      user: deps.user,
      onDay: now,
      trigger: "calendar_change",
      // Never place a slot in the past: this runs mid-day by definition.
      from: now,
    },
    now,
    newId,
  );

  // A replanned slot carries a fresh grace period, and the sweep that enforces
  // it is driven from the directory — so a plan that does not leave a marker
  // there is a plan whose slots never expire.
  if (result.created > 0) {
    await scheduleWork(
      deps.directory,
      { userId: deps.userId, kind: "grace_sweep", dueAt: now + 60_000 },
      now,
      newId,
    );
  }

  return { conflicts: actionable.length, moved: result.created };
}
