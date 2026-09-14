import {
  createPlanRun,
  isTransaction,
  listActivities,
  listBucket,
  listEventsInRange,
  listSlotsForRange,
  moveSlot,
  progressForRange,
  replacePlannedSlots,
  toSchedulerActivity,
  type UserDatabase,
  userDismissedSlots,
  userTransaction,
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

export const ENGINE_VERSION = "1.1.0";

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
    /** Adding a new activity must not reshuffle accepted placements. */
    preservePlanned?: boolean;
    /** Explicit "Place them for me": retry saved occurrences, never recreate them. */
    retryUnplaced?: boolean;
  },
  now: number,
  newId: () => string,
): Promise<PlanDayResult> {
  if (!isTransaction(db))
    return userTransaction(db, (tx) => planDay(tx, params, now, newId));
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

  const [events, activities, slots, dismissed, unplacedSlots] =
    await Promise.all([
      listEventsInRange(db, bounds.start, bounds.end),
      listActivities(db),
      listSlotsForRange(db, bounds.start, bounds.end),
      userDismissedSlots(db, bounds.start, bounds.end),
      params.retryUnplaced ? listBucket(db) : Promise.resolve([]),
    ]);
  const dismissedIds = new Set(dismissed.map((slot) => slot.id));

  const busy = toBusyBlocks(events);

  // Anything pinned, started or already settled survives a replan untouched.
  const locked = slots
    .filter(
      (s) =>
        ["planned", "live", "started", "completed"].includes(s.status) &&
        (s.isLocked ||
          s.status !== "planned" ||
          params.preservePlanned ||
          s.startsAt < dayStart),
    )
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
   * `completedToday`. Skipped/missed work is still owed. A user dismissal,
   * unlike a pause/archive, means "not today" and must not be recreated.
   *
   * ponytail: sessions, not minutes. A duration minimum whose kept slot was
   * cut short by hand is a session short of its target, and the day says so
   * tomorrow rather than quietly placing a fourth block today.
   */
  const keptToday = new Map<string, number>();
  for (const slot of slots) {
    const keeps =
      slot.status === "planned"
        ? slot.isLocked || params.preservePlanned || slot.startsAt < dayStart
        : ["live", "started", "bucketed"].includes(slot.status) ||
          dismissedIds.has(slot.id);
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

    const occurrences = unplacedSlots.filter(
      (slot) => slot.activityId === row.id,
    );
    const freshNeeded =
      sessionsNeededToday(
        activity,
        {
          completedToday: today.count,
          completedMinutesToday: today.minutes,
          completedThisWeek: week.count,
        },
        weekday,
      ) - (keptToday.get(row.id) ?? 0);
    if (!activity.isActive) continue;
    const sessionsNeeded = Math.max(0, freshNeeded) + occurrences.length;
    if (sessionsNeeded <= 0) continue;

    demands.push({
      activity,
      sessionsNeeded,
      occurrences: occurrences.map((slot) => ({
        id: slot.id,
        minutes: (slot.endsAt - slot.startsAt) / 60_000,
      })),
      preferredAt: anchorMinutes.map((minutes) =>
        preferredInstant(date, zone, minutes),
      ),
    });
  }

  // One-off slots have no activity definition but are still placeable.
  for (const slot of unplacedSlots.filter((slot) => !slot.activityId)) {
    const minutes = (slot.endsAt - slot.startsAt) / 60_000;
    demands.push({
      activity: {
        id: slot.id,
        name: slot.title,
        kind: slot.kind as "focus" | "recovery" | "task",
        isActive: true,
        minimum: { type: "countPerDay", value: 1 },
        sessionMinutes: minutes,
        importance: "normal",
        bufferBeforeMeetingMinutes: 0,
        daysOfWeek: 127,
      },
      sessionsNeeded: 1,
      preferredAt: [],
      occurrences: [{ id: slot.id, minutes }],
    });
  }

  const result = solve({
    dayStart,
    spreadStart: bounds.start,
    dayEnd: bounds.end,
    busy,
    locked,
    demands,
  });

  const activityById = new Map(activities.map((a) => [a.row.id, a.row]));
  const planned = result.placed
    // Locked slots came in as input and already exist; only persist new ones.
    .filter(
      (slot) =>
        !slot.id &&
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
        spreadStart: bounds.start,
        dayEnd: bounds.end,
        locked,
      }),
      placedCount:
        planned.length + result.placed.filter((slot) => slot.id).length,
      unplacedCount: result.unplaced.reduce(
        (sum, item) => sum + item.sessions,
        0,
      ),
      durationMs: Date.now() - started,
    },
    now,
    newId,
  );

  const written = await replacePlannedSlots(
    db,
    {
      from: dayStart,
      to: bounds.end,
      planRunId,
      ...(params.preservePlanned
        ? { preserveIds: slots.map((slot) => slot.id) }
        : {}),
    },
    planned,
    now,
    newId,
  );

  const restored = result.placed.filter((slot) => slot.id);
  for (const slot of restored) {
    if (!slot.id) continue;
    await moveSlot(
      db,
      {
        slotId: slot.id,
        startsAt: slot.start,
        endsAt: slot.end,
        actor: "system",
        reasonCode: "placed_from_unplaced",
      },
      now,
      newId,
    );
  }
  const restoredIds = new Set(restored.map((slot) => slot.id));

  // A shortfall is a real, recoverable occurrence, not just a number on a
  // plan run. Bucket rows consume demand on later plans but never hold time.
  for (const missing of result.unplaced) {
    const activity = activityById.get(missing.activityId);
    if (!activity) continue;
    const alreadySaved = unplacedSlots.filter(
      (slot) =>
        slot.activityId === missing.activityId && !restoredIds.has(slot.id),
    ).length;
    for (let i = 0; i < missing.sessions - alreadySaved; i++) {
      await db.slot.create({
        data: {
          id: newId(),
          activityId: activity.id,
          title: activity.name,
          kind: activity.kind,
          // A day key and duration only, not a pretend appointment. The UI
          // labels initial shortfalls "Not placed" rather than "was 09:00".
          startsAt: new Date(bounds.start),
          endsAt: new Date(bounds.start + activity.sessionMinutes * 60_000),
          timeZone: zone,
          status: "bucketed",
          planRunId,
          createdAt: new Date(now),
          events: {
            create: {
              id: newId(),
              at: new Date(now),
              type: "bucketed",
              actor: "system",
              reasonCode: missing.reason,
              reasonText: "initial_placement",
            },
          },
        },
      });
    }
  }

  return {
    ...result,
    planRunId,
    ...written,
    created: written.created + restored.length,
  };
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
    // Nothing that is not going to happen, and nothing already handed back:
    // a bucketed session holds no time, so it cannot clash with anything.
    if (
      slot.status === "cancelled" ||
      slot.status === "completed" ||
      slot.status === "bucketed"
    )
      continue;

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
