/**
 * Plan capabilities as data.
 *
 * One source of truth used by both sides: the Worker enforces it, the client
 * calls the same function to decide what to disable and which upsell to show.
 * The client call is a convenience — the server call is the truth.
 */

export type PlanId = "free" | "pro";

/** Where a user's plan came from. Resolution order is grant > stripe > default. */
export type PlanSource = "grant" | "stripe" | "default";

export const DEFAULT_MODULES = [
  "up_next",
  "missed_today",
  "today_so_far",
] as const;

export const ALL_MODULES = [
  "up_next",
  "missed_today",
  "today_so_far",
  "start_something_now",
  "sitting_streak",
  "tomorrows_shape",
  "reminders_due",
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

/** 3f: "Up next" is Always on — it cannot be turned off on any plan. */
export const PINNED_MODULES: readonly ModuleKey[] = ["up_next"];

export interface PlanLimits {
  maxActiveActivities: number;
  /** Live re-adaptation when the calendar changes, and missed-item replanning. */
  adaptiveReplan: boolean;
  /** Ranked placement options with consequences (screen 3b). */
  rankedRearrange: boolean;
  modules: readonly ModuleKey[];
  reorderModules: boolean;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    maxActiveActivities: 2,
    adaptiveReplan: false,
    rankedRearrange: false,
    modules: DEFAULT_MODULES,
    reorderModules: false,
  },
  pro: {
    maxActiveActivities: Number.POSITIVE_INFINITY,
    adaptiveReplan: true,
    rankedRearrange: true,
    modules: ALL_MODULES,
    reorderModules: true,
  },
};

export type Capability =
  | { kind: "activity.create"; activeCount: number }
  | { kind: "plan.adaptive" }
  | { kind: "plan.rearrange" }
  | { kind: "dashboard.setModules"; modules: readonly string[] }
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
            reason: "Your day is planned each morning on the free plan.",
            upsell: `${UPGRADE} to have it re-adapt whenever your calendar changes.`,
          };

    case "plan.rearrange":
      return limits.rankedRearrange
        ? { ok: true }
        : {
            ok: false,
            reason: "Pick a new time yourself on the free plan.",
            upsell: `${UPGRADE} to see where it fits and what moves.`,
          };

    case "dashboard.setModules": {
      const allowed = new Set<string>(limits.modules);
      const denied = capability.modules.filter((m) => !allowed.has(m));
      return denied.length === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `Not on the free plan: ${denied.join(", ")}.`,
            upsell: `${UPGRADE} to choose any dashboard module.`,
          };
    }

    case "dashboard.reorder":
      return limits.reorderModules
        ? { ok: true }
        : {
            ok: false,
            reason: "Module order is fixed on the free plan.",
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

  // "past_due" still has access — dunning is Stripe's job, not a hard cutoff
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

/** Modules to show, filtered to what the plan allows and always including the
 *  pinned ones. Used when a user downgrades and their saved layout is too rich. */
export function visibleModules(
  plan: PlanId,
  chosen: readonly string[],
): ModuleKey[] {
  const allowed = PLANS[plan].modules;
  const kept = allowed.filter((m) => chosen.includes(m));
  const withPinned = [...new Set([...PINNED_MODULES, ...kept])];
  return withPinned.filter((m): m is ModuleKey => allowed.includes(m));
}
