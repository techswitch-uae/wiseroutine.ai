/** Milliseconds since the epoch. The scheduler works only in instants -
 *  every timezone and wall-clock concern is resolved by the caller before
 *  input reaches here. That is what keeps this package pure and testable. */
export type Instant = number;

export type Minutes = number;

export interface Interval {
  start: Instant;
  end: Instant;
}

/* ── Calendar events as we store them, provider-agnostic ─────────────────── */

export type BusyStatus = "busy" | "free" | "tentative" | "oof";

export type ResponseStatus = "accepted" | "declined" | "tentative" | "none";

/** Google's `eventType`, normalised. Graph has no equivalent, so Microsoft
 *  events are always "default" and rely on busyStatus instead. */
export type EventKind =
  | "default"
  | "workingLocation"
  | "birthday"
  | "fromGmail"
  | "outOfOffice"
  | "focusTime";

export interface CalendarEvent {
  id: string;
  calendarId: string;
  /** Cross-calendar identity. The same meeting on a work and a personal
   *  calendar shares this, which is how we avoid double-counting it. */
  icalUid?: string;
  title?: string;
  start: Instant;
  end: Instant;
  isAllDay: boolean;
  kind: EventKind;
  busyStatus: BusyStatus;
  responseStatus: ResponseStatus;
  isCancelled: boolean;
}

export interface BusyBlock extends Interval {
  /** Ids of the events that produced this block, after merging. */
  sourceEventIds: string[];
}

/* ── Activities ──────────────────────────────────────────────────────────── */

export type Importance = "low" | "normal" | "high";

export type Minimum =
  | { type: "countPerDay"; value: number }
  | { type: "durationPerDay"; value: Minutes }
  | { type: "countPerWeek"; value: number };

export interface Activity {
  id: string;
  name: string;
  kind: "recovery" | "focus" | "task";
  isActive: boolean;
  minimum: Minimum;
  sessionMinutes: Minutes;
  importance: Importance;
  /** Minutes before a meeting that must stay clear -
   *  3e: "Never before a meeting · leaves 5 min". */
  bufferBeforeMeetingMinutes: Minutes;
  /** Days the activity may run on, as a Sunday=0 bitmask. 0b1111111 = every day. */
  daysOfWeek: number;
}

/** An activity resolved for one specific day: how many sessions it still owes,
 *  and when it would prefer to run. Preferred windows arrive as instants
 *  because converting "07:00 local" to an instant is the caller's job. */
export interface Demand {
  activity: Activity;
  sessionsNeeded: number;
  preferredAt: Instant[];
}

/* ── Output ──────────────────────────────────────────────────────────────── */

export interface PlacedSlot extends Interval {
  activityId: string;
  /** Set on input for user-pinned slots; the planner never moves these. */
  isLocked?: boolean;
}

export type UnplacedReason =
  /** No gap was long enough for one session. */
  | "no_gap"
  /** Gaps existed but every one collided with a pre-meeting buffer. */
  | "buffer_blocked"
  /** The activity does not run on this weekday. */
  | "not_scheduled_today";

export interface Unplaced {
  activityId: string;
  sessions: number;
  reason: UnplacedReason;
}

export interface PlanInput {
  /** The planning window, already resolved from the user's local day. */
  dayStart: Instant;
  dayEnd: Instant;
  busy: BusyBlock[];
  /** Slots the user placed or pinned. Treated as immovable and as busy. */
  locked: PlacedSlot[];
  demands: Demand[];
}

export interface PlanResult {
  placed: PlacedSlot[];
  unplaced: Unplaced[];
}
