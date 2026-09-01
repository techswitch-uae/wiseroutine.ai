/**
 * Plan capabilities as data.
 *
 * One source of truth used by both sides: the Worker enforces it, the client
 * calls the same function to decide what to disable and which upsell to show.
 * The client call is a convenience - the server call is the truth.
 */

export type PlanId = "free" | "pro";

/** Where a user's plan came from. Resolution order is grant > stripe > default. */
export type PlanSource = "grant" | "stripe" | "default";

export const DEFAULT_WIDGETS = [
  "up_next",
  "missed_today",
  "today_so_far",
] as const;

export const ALL_WIDGETS = [
  "up_next",
  "missed_today",
  "today_so_far",
  "start_something_now",
  "sitting_streak",
  "tomorrows_shape",
  "reminders_due",
] as const;

export type WidgetKey = (typeof ALL_WIDGETS)[number];

/** 3f: "Up next" is Always on - it cannot be turned off on any plan. */
export const PINNED_WIDGETS: readonly WidgetKey[] = ["up_next"];

export interface PlanLimits {
  maxActiveActivities: number;
  /** Live re-adaptation when the calendar changes, and missed-item replanning. */
  adaptiveReplan: boolean;
  /** Ranked placement options with consequences (screen 3b). */
  rankedRearrange: boolean;
  widgets: readonly WidgetKey[];
  reorderWidgets: boolean;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    maxActiveActivities: 2,
    adaptiveReplan: false,
    rankedRearrange: false,
    widgets: DEFAULT_WIDGETS,
    reorderWidgets: false,
  },
  pro: {
    maxActiveActivities: Number.POSITIVE_INFINITY,
    adaptiveReplan: true,
    rankedRearrange: true,
    widgets: ALL_WIDGETS,
    reorderWidgets: true,
  },
};

export type Capability =
  | { kind: "activity.create"; activeCount: number }
  | { kind: "plan.adaptive" }
  | { kind: "plan.rearrange" }
  | { kind: "dashboard.setWidgets"; widgets: readonly string[] }
  | { kind: "dashboard.reorder" };

export type Decision =
  | { ok: true }
  | { ok: false; reason: string; upsell: string };

const UPGRADE = "Upgrade to Pro";

/**
 * Can this plan do this?
 *
 * The free activity limit counts **active** activities, not total. Paused is a
 * first-class state in the designs (3e shows "Breathing · Paused"), and a hard
 * total of two would make the activity library in that screen a trap.
 */
export function can(plan: PlanId, capability: Capability): Decision {
  const limits = PLANS[plan];

  switch (capability.kind) {
    case "activity.create":
      return capability.activeCount < limits.maxActiveActivities
        ? { ok: true }
        : {
            ok: false,
            reason: `The free plan keeps ${limits.maxActiveActivities} activities active at a time.`,
            upsell: `${UPGRADE} for unlimited activities, or pause one you are not using.`,
          };

    case "plan.adaptive":
      return limits.adaptiveReplan
        ? { ok: true }
        : {
            ok: false,
            reason: "You choose when to fill your day on the free plan.",
            upsell: `${UPGRADE} to have it proposed each morning, and re-adapt whenever your calendar changes.`,
          };

    case "plan.rearrange":
      return limits.rankedRearrange
        ? { ok: true }
        : {
            ok: false,
            reason: "Pick a new time yourself on the free plan.",
            upsell: `${UPGRADE} to see where it fits and what moves.`,
          };

    case "dashboard.setWidgets": {
      const allowed = new Set<string>(limits.widgets);
      const denied = capability.widgets.filter((w) => !allowed.has(w));
      return denied.length === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `Not on the free plan: ${denied.join(", ")}.`,
            upsell: `${UPGRADE} to choose any widget.`,
          };
    }

    case "dashboard.reorder":
      return limits.reorderWidgets
        ? { ok: true }
        : {
            ok: false,
            reason: "Widget order is fixed on the free plan.",
            upsell: `${UPGRADE} to arrange your dashboard.`,
          };
  }
}

export interface PlanState {
  plan: PlanId;
  source: PlanSource;
  /** Set when a beta grant or subscription period ends. */
  expiresAt?: number;
}

/**
 * Resolve the effective plan.
 *
 * A grant outranks Stripe so beta users keep Pro even with no subscription, and
 * winding the beta down is a per-user change with an audit trail rather than a
 * mystery global flag.
 */
export function resolvePlan(
  input: {
    grant?: { plan: PlanId; expiresAt?: number | null };
    subscription?: { status: string; currentPeriodEnd?: number | null };
  },
  now: number,
): PlanState {
  const { grant, subscription } = input;

  if (grant && (grant.expiresAt == null || grant.expiresAt > now)) {
    return {
      plan: grant.plan,
      source: "grant",
      ...(grant.expiresAt != null ? { expiresAt: grant.expiresAt } : {}),
    };
  }

  // "past_due" still has access - dunning is Stripe's job, not a hard cutoff
  // the moment a card bounces.
  const ACTIVE = new Set(["active", "trialing", "past_due"]);
  if (subscription && ACTIVE.has(subscription.status)) {
    return {
      plan: "pro",
      source: "stripe",
      ...(subscription.currentPeriodEnd != null
        ? { expiresAt: subscription.currentPeriodEnd }
        : {}),
    };
  }

  return { plan: "free", source: "default" };
}

/**
 * The widgets to draw, in the order to draw them.
 *
 * `chosen` is the user's own list, already ordered and already filtered to
 * what they have enabled - the `widgets` table read by position. Filtering it
 * to what the plan allows is what makes a downgrade safe: a saved layout too
 * rich for the plan loses the entries it may not have rather than being thrown
 * away.
 *
 * **Order follows `chosen`, not the plan.** The previous version filtered
 * `ALL_WIDGETS` by membership in `chosen`, which returned them in the
 * hard-coded order of that constant - so `position` could be written and would
 * never be read, and dragging a widget did nothing. Ordering is the whole
 * point of the column.
 *
 * A pinned widget the user has not chosen is prepended, because it cannot be
 * turned off and has nowhere else to go. One they *have* chosen keeps their
 * position: pinned means "always present", not "always first".
 *
 * Keys naming an addon (`addonId/widgetKey`) pass through untouched. Whether
 * that addon is installed and enabled is not a question this package can
 * answer - it has no database, by design, exactly like the rest of
 * `@wiseroutine/plans` - so the caller checks it. What is settled here is that
 * the plan does not gate them by name, because their names are not knowable
 * from inside this file.
 */
export const isAddonWidget = (key: string): boolean => key.includes("/");

export function visibleWidgets(
  plan: PlanId,
  chosen: readonly string[],
): string[] {
  const allowed = new Set<string>(PLANS[plan].widgets);
  const kept = chosen.filter((w) => allowed.has(w) || isAddonWidget(w));
  const missingPins = PINNED_WIDGETS.filter((w) => !kept.includes(w));
  return [...new Set([...missingPins, ...kept])];
}
