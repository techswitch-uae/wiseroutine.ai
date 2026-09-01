import {
  createPlanRun,
  listActivities,
  listEventsInRange,
  listSlotsForRange,
  progressForRange,
  replacePlannedSlots,
  toSchedulerActivity,
  type UserDatabase,
} from "@wiseroutine/db";
import {
  type Demand,
  dayBounds,
  findOverlap,
  localDateOf,
  localWeekday,
  type PlanResult,
  preferredInstant,
  sessionsNeededToday,
  plan as solve,
  toBusyBlocks,
} from "@wiseroutine/scheduler";

export const ENGINE_VERSION = "1.0.0";

/** The key a plan run is filed under. Spelled once, because `GET /today` asks
 *  "has this day been planned?" with it and this module answers with it. */
export const localDateKey = (date: {
  year: number;
  month: number;
  day: number;
}): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

export type PlanTrigger =
  | "morning"
  | "calendar_change"
  | "user_request"
  | "missed_replan";

/** The user settings the planner needs. They live in the directory, so the
 *  caller passes them in rather than the planner making a second round trip. */
export interface PlannerUser {
  timeZone: string;
  dayStartMinutes: number;
  dayEndMinutes: number;
}

export interface PlanDayResult extends PlanResult {
  planRunId: string;
  removed: number;
  created: number;
}

/**
 * Plan one local day.
 *
 * All the wall-clock work happens here, at the boundary: the day bounds and
 * each activity's preferred windows are resolved into instants before the
 * solver sees them. The solver itself never knows what a timezone is.
 */
export async function planDay(
  db: UserDatabase,
  params: {
    user: PlannerUser;
    /** Any instant inside the target local day. */
    onDay: number;
    trigger: PlanTrigger;
    /** Plan only from here onward, so a mid-day replan cannot place a slot in
     *  the past. */
    from?: number;
  },
  now: number,
  newId: () => string,
): Promise<PlanDayResult> {
  const started = Date.now();
  const zone = params.user.timeZone;
  const date = localDateOf(params.onDay, zone);
  const bounds = dayBounds(
    date,
    zone,
    params.user.dayStartMinutes,
    params.user.dayEndMinutes,
  );
  const dayStart = Math.max(bounds.start, params.from ?? bounds.start);

  const [events, activities, slots] = await Promise.all([
    listEventsInRange(db, bounds.start, bounds.end),
    listActivities(db),
    listSlotsForRange(db, bounds.start, bounds.end),
  ]);

  const busy = toBusyBlocks(events);

  // Anything pinned, started or already settled survives a replan untouched.
  const locked = slots
    .filter((s) => s.isLocked || s.status !== "planned")
    .map((s) => ({
      activityId: s.activityId ?? s.id,
      start: s.startsAt,
      end: s.endsAt,
    }));

  /**
   * Sessions already on the day that the replan will keep, per activity.
   *
   * The demand below is worked out from what has been *completed*, which was
   * the whole story for as long as the planner was the only thing that put
   * anything on a day. It is not: a session dragged onto the timeline by hand
   * is pinned, so it survives this replan untouched - and asking for three
   * more on top of it is how "place the rest for me" placed the lot again.
   *
   * Completed slots are left out on purpose: they are already counted, in
   * `completedToday`. So are the ones that will not happen - skipped, missed,
   * cancelled - because a day that lost one still owes it.
   *
   * ponytail: sessions, not minutes. A duration minimum whose kept slot was
   * cut short by hand is a session short of its target, and the day says so
   * tomorrow rather than quietly placing a fourth block today.
   */
  const keptToday = new Map<string, number>();
  for (const slot of slots) {
    const keeps =
      slot.status === "planned"
        ? slot.isLocked
        : slot.status === "live" || slot.status === "started";
    if (!keeps || !slot.activityId) continue;
    keptToday.set(slot.activityId, (keptToday.get(slot.activityId) ?? 0) + 1);
  }

  const weekday = localWeekday(dayStart, zone);
  const weekStart = dayStart - weekday * 86_400_000;
  const [todayProgress, weekProgress] = await Promise.all([
    progressForRange(db, bounds.start, bounds.end),
    progressForRange(db, weekStart, bounds.end),
  ]);

  const demands: Demand[] = [];
  for (const { row, anchorMinutes } of activities) {
    const activity = toSchedulerActivity(row);
    const today = todayProgress.get(row.id) ?? { count: 0, minutes: 0 };
    const week = weekProgress.get(row.id) ?? { count: 0, minutes: 0 };

    const sessionsNeeded =
      sessionsNeededToday(
        activity,
        {
          completedToday: today.count,
          completedMinutesToday: today.minutes,
          completedThisWeek: week.count,
        },
        weekday,
      ) - (keptToday.get(row.id) ?? 0);
    if (sessionsNeeded <= 0) continue;

    demands.push({
      activity,
      sessionsNeeded,
      preferredAt: anchorMinutes.map((minutes) =>
        preferredInstant(date, zone, minutes),
      ),
    });
  }

  const result = solve({ dayStart, dayEnd: bounds.end, busy, locked, demands });

  const activityById = new Map(activities.map((a) => [a.row.id, a.row]));
  const planned = result.placed
    // Locked slots came in as input and already exist; only persist new ones.
    .filter(
      (slot) =>
        !locked.some((l) => l.start === slot.start && l.end === slot.end),
    )
    .map((slot) => {
      const activity = activityById.get(slot.activityId);
      return {
        activityId: activity?.id ?? null,
        title: activity?.name ?? "Slot",
        kind: (activity?.kind ?? "recovery") as "recovery" | "focus" | "task",
        startsAt: slot.start,
        endsAt: slot.end,
        timeZone: zone,
      };
    });

  const planRunId = await createPlanRun(
    db,
    {
      localDate: localDateKey(date),
      trigger: params.trigger,
      engineVersion: ENGINE_VERSION,
      inputsHash: await hashInputs({
        busy,
        demands,
        dayStart,
        dayEnd: bounds.end,
      }),
      placedCount: planned.length,
      unplacedCount: result.unplaced.length,
      durationMs: Date.now() - started,
    },
    now,
    newId,
  );

  const written = await replacePlannedSlots(
    db,
    { from: dayStart, to: bounds.end, planRunId },
    planned,
    now,
    newId,
  );

  return { ...result, planRunId, ...written };
}

/**
 * A stable fingerprint of the solver's inputs.
 *
 * With `engineVersion` this is what makes a plan reproducible: a real user's
 * day can be replayed against a new engine and the output diffed before the
 * change ships.
 */
async function hashInputs(input: unknown): Promise<string> {
  const json = JSON.stringify(input);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ConflictSeverity = "edge" | "partial" | "contained";

export interface DetectedConflict {
  slotId: string;
  eventId: string;
  severity: ConflictSeverity;
  overlapMs: number;
}

/** Overlaps below this are noise, and notifying about them is what turns a
 *  useful stream into one the user mutes. */
const EDGE_THRESHOLD_MS = 5 * 60_000;

/**
 * Find slots that a newly-synced meeting now sits on top of.
 *
 * The design explicitly allows the overlap to exist and be shown rather than
 * silently resolved, so this only classifies - it does not move anything.
 */
export async function detectConflicts(
  db: UserDatabase,
  from: number,
  to: number,
): Promise<DetectedConflict[]> {
  const [events, slots] = await Promise.all([
    listEventsInRange(db, from, to),
    listSlotsForRange(db, from, to),
  ]);

  const busy = toBusyBlocks(events);
  const conflicts: DetectedConflict[] = [];

  for (const slot of slots) {
    if (slot.status === "cancelled" || slot.status === "completed") continue;

    const block = findOverlap({ start: slot.startsAt, end: slot.endsAt }, busy);
    if (!block) continue;

    const overlapMs =
      Math.min(slot.endsAt, block.end) - Math.max(slot.startsAt, block.start);
    const contained = block.start <= slot.startsAt && block.end >= slot.endsAt;

    conflicts.push({
      slotId: slot.id,
      eventId: block.sourceEventIds[0] ?? "",
      severity: contained
        ? "contained"
        : overlapMs < EDGE_THRESHOLD_MS
          ? "edge"
          : "partial",
      overlapMs,
    });
  }

  return conflicts;
}
