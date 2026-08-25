import type { Activity, Minutes } from "./types";

export interface Progress {
  /** Sessions completed today. */
  completedToday: number;
  /** Minutes completed today — only used by `durationPerDay`. */
  completedMinutesToday: Minutes;
  /** Sessions completed so far this week — only used by `countPerWeek`. */
  completedThisWeek: number;
}

export const NO_PROGRESS: Progress = {
  completedToday: 0,
  completedMinutesToday: 0,
  completedThisWeek: 0,
};

export function runsOn(activity: Activity, weekday: number): boolean {
  return (activity.daysOfWeek & (1 << weekday)) !== 0;
}

/** How many eligible days remain this week, counting today. Week starts Sunday. */
function eligibleDaysLeft(activity: Activity, weekday: number): number {
  let count = 0;
  for (let d = weekday; d <= 6; d++) {
    if (runsOn(activity, d)) count++;
  }
  return count;
}

/**
 * How many sessions this activity still owes today.
 *
 * The three minimum types from screen 3e all resolve to a session count here,
 * which is the only thing the solver needs to know. Keeping the interpretation
 * in one small pure function means the solver never grows a `minimum.type`
 * switch.
 */
export function sessionsNeededToday(
  activity: Activity,
  progress: Progress,
  weekday: number,
): number {
  if (!activity.isActive) return 0;
  if (!runsOn(activity, weekday)) return 0;

  const { minimum } = activity;

  switch (minimum.type) {
    case "countPerDay":
      return Math.max(0, minimum.value - progress.completedToday);

    case "durationPerDay": {
      const remaining = minimum.value - progress.completedMinutesToday;
      if (remaining <= 0) return 0;
      return Math.ceil(remaining / activity.sessionMinutes);
    }

    case "countPerWeek": {
      const remaining = minimum.value - progress.completedThisWeek;
      if (remaining <= 0) return 0;
      const daysLeft = eligibleDaysLeft(activity, weekday);
      if (daysLeft <= 0) return 0;
      // ponytail: even spread, which front-loads slightly when ahead of pace
      // (1 of 3 remaining over 3 days still schedules today). Predictable, and
      // "done early" beats "perfectly spaced" for a weekly minimum.
      return Math.min(remaining, Math.ceil(remaining / daysLeft));
    }
  }
}
