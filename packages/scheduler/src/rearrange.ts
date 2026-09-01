/**
 * What to do with the day after the calendar moved under it.
 *
 * `plan()` answers "where does everything go on an empty day". This answers a
 * different question: "a meeting just landed on three of my slots - now what?"
 * Re-running `plan()` would answer it by rebuilding the whole day, which is
 * correct and useless: the user watched four blocks they had already accepted
 * jump for one meeting that moved twenty minutes.
 *
 * So this repairs rather than replans. Only the slots the change actually
 * broke are touched, earliest first, each into whatever space is left. Every
 * move has one meeting behind it, and the UI can say which.
 *
 * The pass is deliberately linear - one slot at a time, one decision per slot,
 * in this order:
 *
 *   1. Which slots are ours to move?      past / running / broken / intact
 *   2. Where could this one go?           candidate positions in free space
 *   3. Which of those are allowed?        the spacing rule, and only that
 *   4. Which is best?                     drift, plus what a missing breather costs
 *   5. Do we need to ask?                 window and drift decide
 *
 * Nothing loops back. A slot that reaches step 3 with no candidates is
 * bucketed and the pass moves on; it is never reconsidered once something else
 * has been placed. That is what makes the result explicable and the same every
 * time.
 *
 * Three outcomes, and what separates them:
 *
 *   moved      inside a configured window and close to where it was. Applied.
 *              Nobody wants to confirm 10:00 becoming 10:30.
 *   suggested  a position exists but leaves the window, or moves far enough
 *              that it is a different plan. Drawn as a suggestion slot - a
 *              morning stretch that can only go at four o'clock is a decision.
 *   blocked    no position we would stand behind. Never guessed at; collected
 *              into a bucket, because the answer is "drop something" and that
 *              is the user's call.
 *
 * Pure, like the rest of this package: instants in, instants out, no clock and
 * no I/O. Every window arrives already resolved from wall-clock by the caller.
 */

import { freeGaps } from "./busy";
import type { Activity, BusyBlock, Instant, Interval, Minutes } from "./types";

const MINUTE = 60_000;

/**
 * How far a slot may be shunted before the move stops being a repair and
 * starts being a decision. An hour is roughly "the same part of the day".
 *
 * Only consulted for an activity with no window - see `classify`.
 */
export const AUTO_DRIFT_MS = 60 * MINUTE;

/* ── The breather ────────────────────────────────────────────────────────── */

/**
 * How much room to leave between a session and whatever it sits next to.
 *
 * A stretch that starts the second a two-hour call ends is a stretch nobody
 * does. The user needs a minute to close the laptop, and possibly the
 * bathroom. So a placement prefers a gap either side of its neighbour, sized
 * by how long that neighbour ran.
 *
 * Configurable because the right answer is a person, not a constant: one user
 * wants ten minutes to make coffee, another finds any gap a waste of a day
 * that is already too full. Every field is in minutes, which is the unit a
 * settings screen speaks and the unit `Activity.bufferBeforeMeetingMinutes`
 * already uses.
 *
 * Preferred, never required - see `weight`. A session that only fits tightly
 * is still placed tightly, because a tight session beats no session.
 */
export interface BreatherRule {
  /** Wanted beside any neighbour. Zero turns the rule off. */
  minutes: Minutes;
  /** A neighbour running at least this long earns `longMinutes` instead. */
  longNeighbourMinutes: Minutes;
  /** Wanted beside a long neighbour. */
  longMinutes: Minutes;
  /**
   * What a missing minute of breather is worth, in minutes of drift.
   *
   * Two, so a placement will accept being ten minutes further from home to
   * gain a five-minute breather, but will not cross the day for one. A tuning
   * knob rather than a setting - it prices the preference, and a settings
   * screen should offer the size of the gap, not its exchange rate.
   */
  weight: number;
}

export const DEFAULT_BREATHER: BreatherRule = {
  minutes: 5,
  longNeighbourMinutes: 45,
  longMinutes: 10,
  weight: 2,
};

/**
 * What "no gap, thanks" resolves to.
 *
 * The per-activity `bufferBeforeMeetingMinutes` still applies - that is the
 * user asking for room on one particular activity, and a global preference for
 * a packed day is not a way to overrule it.
 *
 * Which is why `weight` stays at the default rather than dropping to zero.
 * Zero prices *every* shortfall at nothing, including the one the per-activity
 * buffer creates, so turning the global gap off would have quietly turned that
 * buffer off with it. The gap sizes are the setting; the weight is what makes
 * any of them mean anything.
 */
export const NO_BREATHER: BreatherRule = {
  minutes: 0,
  longNeighbourMinutes: 0,
  longMinutes: 0,
  weight: DEFAULT_BREATHER.weight,
};

/**
 * Fill in and sanity-check a rule that came from settings.
 *
 * A negative gap is not a rule, it is a bug arriving from the edge of the
 * system - it would make a shortfall negative and pay a placement to sit
 * *inside* its neighbour. Clamped here, once, rather than defended against at
 * each of the four places the numbers are read.
 */
export function resolveBreather(
  rule: Partial<BreatherRule> | undefined,
): BreatherRule {
  const sane = (value: number | undefined, fallback: Minutes): number =>
    value !== undefined && Number.isFinite(value) && value >= 0
      ? value
      : fallback;
  return {
    minutes: sane(rule?.minutes, DEFAULT_BREATHER.minutes),
    longNeighbourMinutes: sane(
      rule?.longNeighbourMinutes,
      DEFAULT_BREATHER.longNeighbourMinutes,
    ),
    longMinutes: sane(rule?.longMinutes, DEFAULT_BREATHER.longMinutes),
    weight: sane(rule?.weight, DEFAULT_BREATHER.weight),
  };
}

/**
 * The breather a neighbour of this length earns, in milliseconds.
 *
 * Exported so the simulator can draw the rule rather than restate it - a
 * diagnostic view that reimplements the thing it is diagnosing agrees with
 * itself and nothing else. Expects a rule that has been through
 * `resolveBreather`.
 */
export const breatherFor = (rule: BreatherRule, neighbourMs: number): number =>
  (neighbourMs >= rule.longNeighbourMinutes * MINUTE
    ? rule.longMinutes
    : rule.minutes) * MINUTE;

/* ── Spacing ─────────────────────────────────────────────────────────────── */

/**
 * The closest two sessions of the same activity may ever be.
 *
 * Two deep-work blocks back to back is one long block that lies about being
 * two, and four eye rests inside an hour is one eye rest and three
 * interruptions. Neither is worth suggesting, because there is no version of
 * it the user wants - so a session with nowhere far enough from its siblings
 * goes to the bucket rather than being offered.
 */
export const MIN_SIBLING_GAP_MS = 30 * MINUTE;

/** A spread activity wants `span / sessions` between sessions; landing at less
 *  than this fraction of that is bunched. */
export const SPREAD_TOLERANCE = 0.6;

/* ── Input ───────────────────────────────────────────────────────────────── */

/**
 * Where an activity is allowed to run, and how its sessions relate.
 *
 * Windows are instants, not "06:00" - resolving wall-clock is the caller's job
 * everywhere in this package, and a window is no exception. Empty means the
 * whole day, which is the honest reading of "no preference".
 */
export interface PlacementPolicy {
  /** Allowed regions. A slot must fit *entirely* inside one; a stretch that
   *  straddles noon is not a morning stretch. */
  windows: Interval[];
  /** Sessions should be spaced across the allowed region rather than
   *  clustered. Raises the spacing requirement above the floor. */
  spread: boolean;
}

export const ANYWHERE: PlacementPolicy = { windows: [], spread: false };

/**
 * A slot's lifecycle state.
 *
 * There is no pinned or locked state, deliberately. A slot the user dragged
 * into place is still a slot the day has to make room around, and exempting it
 * only means the day goes stale in one spot. If pinning is ever wanted it is a
 * product decision with its own UI, not a flag the solver quietly honours.
 *
 * `skipped` and `missed` are past-tense: they describe a session that did not
 * happen, so they only ever appear on a slot whose time has gone.
 */
export type SlotStatus =
  | "planned"
  | "live"
  | "started"
  | "completed"
  | "skipped"
  | "missed"
  | "cancelled";

export interface CurrentSlot extends Interval {
  id: string;
  activityId: string;
  status: SlotStatus;
}

export interface RearrangeInput {
  now: Instant;
  /** The user's day, already resolved. Nothing is placed outside it. */
  dayStart: Instant;
  dayEnd: Instant;
  /** Busy blocks *after* the calendar change. */
  busy: BusyBlock[];
  slots: CurrentSlot[];
  /** Keyed by activity id. A slot whose activity is missing here is left
   *  alone - we cannot reason about rules we do not have. */
  activities: Record<string, { activity: Activity; policy: PlacementPolicy }>;
  /** How much room to leave around a session. Omitted takes
   *  `DEFAULT_BREATHER`; `NO_BREATHER` turns it off. */
  breather?: Partial<BreatherRule>;
}

/* ── Output ──────────────────────────────────────────────────────────────── */

export type PlacementReason =
  /** Landed outside every configured window. */
  | "outside_window"
  /** Far enough from where it was that it is a different plan, not a nudge. */
  | "large_drift";

export type BlockedReason =
  /** No remaining gap is long enough. */
  | "no_gap"
  /** Room existed, but only crowded against another session of the same
   *  activity. Bucketed rather than suggested: there is no version of two
   *  back-to-back eye rests the user wants. */
  | "too_close"
  /** The day is over - `now` is at or past `dayEnd`. */
  | "day_over";

export interface Relocation {
  slotId: string;
  activityId: string;
  from: Interval;
  to: Interval;
  /** Empty on a clean move. Anything here is why we are asking. */
  reasons: PlacementReason[];
  driftMs: number;
  /** How much breather the position gives up, in ms. Zero is unhurried. */
  breatherShortfallMs: number;
  /** The busy blocks that displaced it. */
  displacedBy: string[];
}

export interface BlockedSession {
  slotId: string;
  activityId: string;
  from: Interval;
  reason: BlockedReason;
}

export interface RearrangeResult {
  /** Applied without asking. */
  moved: Relocation[];
  /** Drawn as suggestion slots, pending confirmation. */
  suggested: Relocation[];
  /** The bucket the widget reports. Nothing is invented for these. */
  blocked: BlockedSession[];
  /** Ids of slots that were already fine and were not touched. */
  kept: string[];
  /** Ids of slots that collide but are ours no longer - running, or already
   *  begun by the clock. Reported, never relocated. */
  frozenConflicts: string[];
}

/* ── Geometry ────────────────────────────────────────────────────────────── */

const overlaps = (a: Interval, b: Interval): boolean =>
  a.start < b.end && b.start < a.end;

/**
 * Which busy blocks a slot sits on top of.
 *
 * Any overlap at all, with no tolerance. A meeting that runs four minutes into
 * a stretch has taken four minutes of it, and the version of this that ignored
 * small overlaps left the user watching a meeting eat the top of a session
 * while the app said everything was fine.
 */
const collisions = (slot: Interval, busy: readonly BusyBlock[]): BusyBlock[] =>
  busy.filter((block) => overlaps(slot, block));

function insideAnyWindow(
  slot: Interval,
  windows: readonly Interval[],
): boolean {
  if (windows.length === 0) return true;
  return windows.some((w) => slot.start >= w.start && slot.end <= w.end);
}

/** Total placeable span the policy allows, which is what "spread" spreads
 *  across. No windows means the whole day. */
function allowedSpan(policy: PlacementPolicy, day: Interval): number {
  if (policy.windows.length === 0) return day.end - day.start;
  return policy.windows.reduce((sum, w) => sum + (w.end - w.start), 0);
}

/** Distance to the nearest session of the same activity. Negative when they
 *  overlap, Infinity when this is the only one. */
function nearestSibling(slot: Interval, siblings: readonly Interval[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const other of siblings) {
    const gap =
      other.start >= slot.end
        ? other.start - slot.end
        : other.end <= slot.start
          ? slot.start - other.end
          : -1;
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * How much breathing room a position gives up, either side.
 *
 * Measured against whatever is actually adjacent - a meeting or another of our
 * own sessions, because landing flush against either one is the same problem.
 * A slot in the middle of a wide-open afternoon gives up nothing; one wedged
 * against a three-hour call gives up whatever it could not leave.
 *
 * The activity's own `bufferBeforeMeetingMinutes` raises the floor on the
 * leading side - that setting is the user asking for more room, never less.
 */
function breatherShortfall(
  slot: Interval,
  occupied: readonly Interval[],
  bufferMs: number,
  rule: BreatherRule,
): number {
  let before: Interval | undefined;
  let after: Interval | undefined;
  for (const block of occupied) {
    if (block.end <= slot.start && (!before || block.end > before.end)) {
      before = block;
    }
    if (block.start >= slot.end && (!after || block.start < after.start)) {
      after = block;
    }
  }

  let shortfall = 0;
  if (before) {
    const want = breatherFor(rule, before.end - before.start);
    shortfall += Math.max(0, want - (slot.start - before.end));
  }
  if (after) {
    const want = Math.max(bufferMs, breatherFor(rule, after.end - after.start));
    shortfall += Math.max(0, want - (after.start - slot.end));
  }
  return shortfall;
}

/* ── Candidate search ────────────────────────────────────────────────────── */

interface Candidate {
  start: Instant;
  drift: number;
  shortfall: number;
  outside: boolean;
  /** Drift plus what the missing breather is worth. Lower wins. */
  cost: number;
}

interface Search {
  duration: number;
  bufferMs: number;
  policy: PlacementPolicy;
  origin: Instant;
  /** Everything that holds time: meetings and the slots staying put. */
  occupied: readonly Interval[];
  breather: BreatherRule;
  /** Other sessions of the same activity that will be on the day. */
  siblings: readonly Interval[];
  /** How far this session must stay from any of them. */
  requiredGap: number;
}

/**
 * The positions worth scoring inside one gap.
 *
 * A finite set rather than a scan. Every position that can win is a boundary
 * of something - the gap, a window, where the slot already is, the breather
 * either side, or exactly the required distance from a sibling - so scanning
 * by the minute would cost a thousand evaluations to rediscover the same
 * handful. It also keeps the result stable: the same day always produces the
 * same candidates in the same order.
 */
function positionsIn(gap: Interval, search: Search): Instant[] {
  const latest = gap.end - search.duration;
  if (latest < gap.start) return [];

  const raw: Instant[] = [gap.start, latest, search.origin];

  for (const w of search.policy.windows) {
    raw.push(w.start, w.end - search.duration);
  }
  for (const sibling of search.siblings) {
    raw.push(sibling.end + search.requiredGap);
    raw.push(sibling.start - search.requiredGap - search.duration);
  }
  // The breather positions: just clear of whatever bounds this gap.
  for (const block of search.occupied) {
    if (block.end <= gap.start) {
      raw.push(
        block.end + breatherFor(search.breather, block.end - block.start),
      );
    }
    if (block.start >= gap.end) {
      const want = Math.max(
        search.bufferMs,
        breatherFor(search.breather, block.end - block.start),
      );
      raw.push(block.start - want - search.duration);
    }
  }

  const clamped = raw.map((t) => Math.min(Math.max(t, gap.start), latest));
  return [...new Set(clamped)].sort((a, b) => a - b);
}

/**
 * The best position, or why there is none.
 *
 * Two failures, and telling them apart is the whole value of the message the
 * user gets: `no_gap` means the day is full, `too_close` means the day has
 * room but only shoulder to shoulder with the same activity.
 */
function search(
  gaps: readonly Interval[],
  params: Search,
): { best: Candidate } | { failed: "no_gap" | "too_close" } {
  let best: Candidate | undefined;
  let sawAnyPosition = false;

  for (const gap of gaps) {
    for (const start of positionsIn(gap, params)) {
      sawAnyPosition = true;
      const slot = { start, end: start + params.duration };

      // The one hard rule. Everything else is a preference expressed as cost.
      if (nearestSibling(slot, params.siblings) < params.requiredGap) continue;

      const shortfall = breatherShortfall(
        slot,
        params.occupied,
        params.bufferMs,
        params.breather,
      );
      const drift = Math.abs(start - params.origin);
      const candidate: Candidate = {
        start,
        drift,
        shortfall,
        outside: !insideAnyWindow(slot, params.policy.windows),
        cost: drift + params.breather.weight * shortfall,
      };

      // Inside a window beats any amount of cost: a morning stretch that fits
      // the morning is the answer, however far into it we had to reach.
      const wins =
        !best ||
        (Number(candidate.outside) !== Number(best.outside)
          ? !candidate.outside
          : candidate.cost !== best.cost
            ? candidate.cost < best.cost
            : candidate.start < best.start);
      if (wins) best = candidate;
    }
  }

  if (best) return { best };
  return { failed: sawAnyPosition ? "too_close" : "no_gap" };
}

/* ── The pass ────────────────────────────────────────────────────────────── */

/** Slots that still hold time but are no longer ours to move. */
const isFrozen = (slot: CurrentSlot, now: Instant): boolean =>
  // Already begun by the clock, whatever the status says. Moving something the
  // user may be in the middle of is worse than leaving it where it clashes.
  slot.status !== "planned" || slot.start < now;

/** Slots that will not happen and should not block a repair. */
const isGone = (slot: CurrentSlot): boolean =>
  slot.status === "cancelled" ||
  slot.status === "skipped" ||
  slot.status === "missed";

/**
 * Repair the day.
 *
 * Broken slots are handled earliest-first, so a morning displacement claims
 * its space before an afternoon one competes for it, and the cascade reads the
 * way the day does. Each placement immediately becomes occupied for the next,
 * which is what keeps two displaced slots from both being offered the same gap.
 *
 * ponytail: a displaced slot only takes *free* space - it never pushes a slot
 * that was fine out of the way. Predictable, and it means a repair can never
 * ripple further than the meeting that caused it. If real days show good space
 * is routinely held by an unbroken slot, the upgrade is a second pass that
 * allows one level of displacement.
 */
export function rearrange(input: RearrangeInput): RearrangeResult {
  const breather = resolveBreather(input.breather);

  const result: RearrangeResult = {
    moved: [],
    suggested: [],
    blocked: [],
    kept: [],
    frozenConflicts: [],
  };

  const live = input.slots.filter((s) => !isGone(s));
  // Wholly in the past: neither moves nor blocks. A day that has finished has
  // finished, and a meeting dragged onto this morning at five o'clock is not
  // something we can do anything about.
  const current = live.filter((s) => s.end > input.now);
  const past = live.filter((s) => s.end <= input.now);

  const frozen = current.filter((s) => isFrozen(s, input.now));
  const movable = current.filter((s) => !isFrozen(s, input.now));

  for (const slot of frozen) {
    if (collisions(slot, input.busy).length > 0) {
      result.frozenConflicts.push(slot.id);
    }
  }

  const broken: CurrentSlot[] = [];
  const intact: CurrentSlot[] = [];
  for (const slot of movable) {
    if (collisions(slot, input.busy).length > 0) broken.push(slot);
    else intact.push(slot);
  }
  result.kept = intact.map((s) => s.id);

  if (broken.length === 0) return result;

  // Placement happens from now onward, or from the start of the day when the
  // day has not begun - a change to next Tuesday rearranges all of Tuesday.
  const from = Math.max(input.dayStart, input.now);
  const day = { start: from, end: input.dayEnd };

  if (from >= input.dayEnd) {
    for (const slot of sorted(broken)) {
      result.blocked.push({
        slotId: slot.id,
        activityId: slot.activityId,
        from: { start: slot.start, end: slot.end },
        reason: "day_over",
      });
    }
    return result;
  }

  // Everything that still holds time. Relocations join it as they land.
  const occupied: Interval[] = [
    ...input.busy.map((b) => ({ start: b.start, end: b.end })),
    ...frozen.map((s) => ({ start: s.start, end: s.end })),
    ...intact.map((s) => ({ start: s.start, end: s.end })),
  ];

  // Siblings for the spacing rule: every session of the activity that will
  // still be on the day, including ones already done - four eye rests are
  // spread across the day, not across the rest of it.
  const siblings = new Map<string, Interval[]>();
  const sessionCount = new Map<string, number>();
  for (const slot of [...past, ...frozen, ...intact]) {
    siblings.set(slot.activityId, [
      ...(siblings.get(slot.activityId) ?? []),
      { start: slot.start, end: slot.end },
    ]);
  }
  for (const slot of live) {
    sessionCount.set(
      slot.activityId,
      (sessionCount.get(slot.activityId) ?? 0) + 1,
    );
  }

  for (const slot of sorted(broken)) {
    const entry = input.activities[slot.activityId];
    if (!entry) {
      // No rules to reason with, so leave it exactly alone.
      result.kept.push(slot.id);
      continue;
    }
    const { activity, policy } = entry;
    const origin = { start: slot.start, end: slot.end };
    const duration = slot.end - slot.start;
    const mine = siblings.get(slot.activityId) ?? [];
    const count = sessionCount.get(slot.activityId) ?? 1;

    const spreadGap =
      policy.spread && count > 1
        ? (allowedSpan(policy, { start: input.dayStart, end: input.dayEnd }) /
            count) *
          SPREAD_TOLERANCE
        : 0;

    const found = search(freeGaps(day, occupied), {
      duration,
      bufferMs: activity.bufferBeforeMeetingMinutes * MINUTE,
      policy,
      origin: slot.start,
      occupied,
      breather,
      siblings: mine,
      requiredGap: Math.max(MIN_SIBLING_GAP_MS, spreadGap),
    });

    if ("failed" in found) {
      result.blocked.push({
        slotId: slot.id,
        activityId: slot.activityId,
        from: origin,
        reason: found.failed,
      });
      continue;
    }

    const { best } = found;
    const to = { start: best.start, end: best.start + duration };

    const reasons: PlacementReason[] = [];
    if (best.outside) reasons.push("outside_window");
    /**
     * Drift is the *fallback* rule, not an extra one.
     *
     * An activity that says where it wants to run has already told us what a
     * bad placement looks like, and distance is not it: a stretch that stays
     * inside its morning has been repaired whether it moved ten minutes or
     * ninety, and an eye rest that kept its spacing is doing its job wherever
     * it sits. Ask about distance as well and a long meeting turns every block
     * on the day into a question - which is how a confirmation people read
     * becomes one they dismiss.
     *
     * So distance only decides for an activity that has stated no preference
     * at all: no window, and no spread.
     */
    const unconstrained = policy.windows.length === 0 && !policy.spread;
    if (unconstrained && best.drift > AUTO_DRIFT_MS) {
      reasons.push("large_drift");
    }

    const relocation: Relocation = {
      slotId: slot.id,
      activityId: slot.activityId,
      from: origin,
      to,
      reasons,
      driftMs: best.drift,
      breatherShortfallMs: best.shortfall,
      displacedBy: collisions(origin, input.busy).flatMap(
        (b) => b.sourceEventIds,
      ),
    };

    if (reasons.length === 0) result.moved.push(relocation);
    else result.suggested.push(relocation);

    // A suggestion holds its space too. Offering the same gap to two slots and
    // letting the user accept both is how a confirmation dialog creates the
    // overlap it was there to prevent.
    occupied.push(to);
    mine.push(to);
    siblings.set(slot.activityId, mine);
  }

  return result;
}

/** Earliest first, then by id. The same day must always produce the same plan,
 *  or the UI cannot honestly say what a change will displace. */
const sorted = (slots: readonly CurrentSlot[]): CurrentSlot[] =>
  [...slots].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));

/** Minutes, for a UI that would otherwise divide by 60000 in six places. */
export const asMinutes = (ms: number): Minutes => Math.round(ms / MINUTE);
