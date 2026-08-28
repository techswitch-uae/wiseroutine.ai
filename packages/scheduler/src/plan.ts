import { freeGaps } from "./busy";
import type {
  Demand,
  Importance,
  Instant,
  PlacedSlot,
  PlanInput,
  PlanResult,
  Unplaced,
  UnplacedReason,
} from "./types";

const MINUTE = 60_000;

const IMPORTANCE_RANK: Record<Importance, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

interface Gap {
  start: Instant;
  end: Instant;
  /** True when this gap butts up against a meeting, so a pre-meeting buffer
   *  applies to anything placed at its tail. */
  endsAtMeeting: boolean;
}

interface Placement {
  gapIndex: number;
  start: Instant;
  /** Distance in ms from the nearest preferred time. Lower wins. */
  cost: number;
}

/** Best position for `duration` inside one gap, or undefined if it won't fit. */
function fitInGap(
  gap: Gap,
  duration: number,
  bufferMs: number,
  preferredAt: readonly Instant[],
): { start: Instant; cost: number } | undefined {
  const limit = gap.endsAtMeeting ? gap.end - bufferMs : gap.end;
  const earliest = gap.start;
  const latest = limit - duration;
  if (latest < earliest) return undefined;

  if (preferredAt.length === 0) {
    // No preference: earliest wins, and cost stays neutral so the gap ordering
    // below falls through to "soonest".
    return { start: earliest, cost: 0 };
  }

  let best: { start: Instant; cost: number } | undefined;
  for (const preferred of preferredAt) {
    const start = Math.min(Math.max(preferred, earliest), latest);
    const cost = Math.abs(start - preferred);
    if (
      !best ||
      cost < best.cost ||
      (cost === best.cost && start < best.start)
    ) {
      best = { start, cost };
    }
  }
  return best;
}

/** Would this session fit anywhere, ignoring buffers? Used to tell "no gap at
 *  all" apart from "a gap existed but the buffer ate it". */
function fitsIgnoringBuffer(gaps: readonly Gap[], duration: number): boolean {
  return gaps.some((g) => g.end - g.start >= duration);
}

function orderDemands(
  demands: readonly Demand[],
  gaps: readonly Gap[],
): Demand[] {
  // Scarcity: an activity that fits in few gaps should claim one before an
  // activity that fits anywhere takes it. Computed once against the initial
  // gaps - an approximation, but a stable and explicable one.
  const viableGaps = new Map<string, number>();
  for (const demand of demands) {
    const duration = demand.activity.sessionMinutes * MINUTE;
    viableGaps.set(
      demand.activity.id,
      gaps.filter((g) => g.end - g.start >= duration).length,
    );
  }

  return [...demands].sort((a, b) => {
    const byImportance =
      IMPORTANCE_RANK[b.activity.importance] -
      IMPORTANCE_RANK[a.activity.importance];
    if (byImportance !== 0) return byImportance;

    const scarcity =
      (viableGaps.get(a.activity.id) ?? 0) -
      (viableGaps.get(b.activity.id) ?? 0);
    if (scarcity !== 0) return scarcity;

    // Deterministic tie-break. The same day must always produce the same plan,
    // or the UI cannot honestly say what a change will displace.
    return a.activity.id < b.activity.id
      ? -1
      : a.activity.id > b.activity.id
        ? 1
        : 0;
  });
}

/**
 * Place the day's sessions into the gaps between busy blocks.
 *
 * Greedy, deterministic, and pure: no clock, no randomness, no I/O. Given the
 * same input it always returns the same plan, which is what lets the quick-add
 * UI promise "this pushes deep work to 12:10" and be right.
 *
 * The caller resolves all wall-clock concerns first - `dayStart`/`dayEnd` and
 * `preferredAt` arrive as instants. To plan only the rest of the day, pass
 * `dayStart: max(localDayStart, now)`.
 */
export function plan(input: PlanInput): PlanResult {
  const bounds = { start: input.dayStart, end: input.dayEnd };
  const lockedIntervals = input.locked.map((s) => ({
    start: s.start,
    end: s.end,
  }));
  const occupied = [...input.busy, ...lockedIntervals];

  let gaps: Gap[] = freeGaps(bounds, occupied).map((g) => ({
    start: g.start,
    end: g.end,
    // A gap that ends before the day does butts up against something busy.
    endsAtMeeting: g.end < bounds.end,
  }));

  const initialGaps = gaps.map((g) => ({ ...g }));
  const placed: PlacedSlot[] = [...input.locked];
  const shortfall = new Map<
    string,
    { sessions: number; reason: UnplacedReason }
  >();

  for (const demand of orderDemands(input.demands, initialGaps)) {
    const { activity } = demand;
    const duration = activity.sessionMinutes * MINUTE;
    const bufferMs = activity.bufferBeforeMeetingMinutes * MINUTE;

    for (let session = 0; session < demand.sessionsNeeded; session++) {
      let best: Placement | undefined;

      for (const [index, gap] of gaps.entries()) {
        const fit = fitInGap(gap, duration, bufferMs, demand.preferredAt);
        if (!fit) continue;
        if (
          !best ||
          fit.cost < best.cost ||
          (fit.cost === best.cost && fit.start < best.start)
        ) {
          best = { gapIndex: index, start: fit.start, cost: fit.cost };
        }
      }

      if (!best) {
        const reason: UnplacedReason = fitsIgnoringBuffer(gaps, duration)
          ? "buffer_blocked"
          : "no_gap";
        const existing = shortfall.get(activity.id);
        shortfall.set(activity.id, {
          sessions:
            (existing?.sessions ?? 0) + (demand.sessionsNeeded - session),
          reason: existing?.reason ?? reason,
        });
        break;
      }

      const end = best.start + duration;
      placed.push({ activityId: activity.id, start: best.start, end });

      // Split the consumed gap into whatever is left either side.
      const gap = gaps[best.gapIndex] as Gap;
      const remainder: Gap[] = [];
      if (best.start > gap.start) {
        remainder.push({
          start: gap.start,
          end: best.start,
          endsAtMeeting: false,
        });
      }
      if (end < gap.end) {
        remainder.push({
          start: end,
          end: gap.end,
          endsAtMeeting: gap.endsAtMeeting,
        });
      }
      gaps = [
        ...gaps.slice(0, best.gapIndex),
        ...remainder,
        ...gaps.slice(best.gapIndex + 1),
      ];
    }
  }

  const unplaced: Unplaced[] = [...shortfall.entries()]
    .map(([activityId, v]) => ({
      activityId,
      sessions: v.sessions,
      reason: v.reason,
    }))
    .sort((a, b) => (a.activityId < b.activityId ? -1 : 1));

  placed.sort(
    (a, b) => a.start - b.start || (a.activityId < b.activityId ? -1 : 1),
  );

  return { placed, unplaced };
}
