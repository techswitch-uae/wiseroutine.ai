import { resolvePlan } from "@wiseroutine/plans";
import { at, atOrNull, type Directory, msOrNull } from "../client";

/** Turso database names are DNS labels: lowercase, alphanumeric and dashes. */
export function databaseNameFor(userId: string): string {
  return `wr-user-${userId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

export function getUser(directory: Directory, userId: string) {
  return directory.user.findUnique({ where: { id: userId } });
}

/**
 * Record that the app is in use.
 *
 * Debounced by the caller, so this is at most one write per user per minute
 * even while someone is clicking around. Deliberately not part of the session
 * read: it is a write on a hot path and worth spending only when the answer
 * changes.
 */
export async function touchLastSeen(
  directory: Directory,
  userId: string,
  now: number,
): Promise<void> {
  await directory.user.update({
    where: { id: userId },
    data: { lastSeenAt: at(now) },
  });
}

export async function markDatabaseReady(
  directory: Directory,
  userId: string,
): Promise<void> {
  await directory.user.update({
    where: { id: userId },
    data: { databaseReady: true },
  });
}

/* ── Plan resolution ─────────────────────────────────────────────────────── */

/**
 * Recompute the user's plan from grants and subscription, and cache it on the
 * user row so request paths read one column.
 *
 * Called by the Stripe webhook and whenever a grant changes — never on the hot
 * path.
 */
export async function refreshUserPlan(
  directory: Directory,
  userId: string,
  now: number,
) {
  const grant = await directory.planGrant.findFirst({
    where: {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: at(now) } }],
    },
    select: { plan: true, expiresAt: true },
  });

  const subscription = await directory.subscription.findUnique({
    where: { userId },
    select: { status: true, currentPeriodEnd: true },
  });

  const state = resolvePlan(
    {
      grant: grant
        ? {
            plan: grant.plan as "free" | "pro",
            expiresAt: msOrNull(grant.expiresAt),
          }
        : undefined,
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: msOrNull(subscription.currentPeriodEnd),
          }
        : undefined,
    },
    now,
  );

  await directory.user.update({
    where: { id: userId },
    data: {
      plan: state.plan,
      planSource: state.source,
      planExpiresAt: atOrNull(state.expiresAt),
    },
  });

  return state;
}

export async function grantPlan(
  directory: Directory,
  input: {
    userId: string;
    plan: "free" | "pro";
    reason: string;
    grantedBy: string;
    expiresAt?: number | null;
  },
  now: number,
  newId: () => string,
) {
  await directory.planGrant.create({
    data: {
      id: newId(),
      userId: input.userId,
      plan: input.plan,
      reason: input.reason,
      grantedBy: input.grantedBy,
      expiresAt: atOrNull(input.expiresAt),
      createdAt: at(now),
    },
  });
  return refreshUserPlan(directory, input.userId, now);
}

/* ── Settings ────────────────────────────────────────────────────────────── */

export interface UserSettingsPatch {
  timeZone?: string;
  dayStartMinutes?: number;
  dayEndMinutes?: number;
  /** Data minimisation: keep busy intervals, drop event titles. */
  storeEventTitles?: boolean;
}

export async function updateUserSettings(
  directory: Directory,
  userId: string,
  patch: UserSettingsPatch,
): Promise<void> {
  const data: UserSettingsPatch = {};
  if (patch.timeZone !== undefined) data.timeZone = patch.timeZone;
  if (patch.dayStartMinutes !== undefined)
    data.dayStartMinutes = patch.dayStartMinutes;
  if (patch.dayEndMinutes !== undefined)
    data.dayEndMinutes = patch.dayEndMinutes;
  if (patch.storeEventTitles !== undefined)
    data.storeEventTitles = patch.storeEventTitles;
  if (Object.keys(data).length === 0) return;

  await directory.user.update({ where: { id: userId }, data });
}
