import { at, atOrNull, type Directory } from "../client";
import { refreshUserPlan } from "./users";

export interface SubscriptionInput {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  status: string;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
}

/** Write the subscription, then recompute the cached plan on the user row so
 *  request paths never have to call Stripe. */
export async function upsertSubscription(
  directory: Directory,
  input: SubscriptionInput,
  now: number,
) {
  const data = {
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    stripePriceId: input.stripePriceId ?? null,
    status: input.status,
    currentPeriodEnd: atOrNull(input.currentPeriodEnd),
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    updatedAt: at(now),
  };

  await directory.subscription.upsert({
    where: { userId: input.userId },
    update: data,
    create: { userId: input.userId, ...data },
  });

  return refreshUserPlan(directory, input.userId, now);
}

/** Indexed lookup. next-forge scans a full user list here, which silently
 *  breaks past a few hundred customers. */
export async function findUserByStripeCustomer(
  directory: Directory,
  stripeCustomerId: string,
): Promise<string | undefined> {
  const row = await directory.subscription.findUnique({
    where: { stripeCustomerId },
    select: { userId: true },
  });
  return row?.userId;
}

export function getSubscription(directory: Directory, userId: string) {
  return directory.subscription.findUnique({ where: { userId } });
}

/* ── Webhook idempotency ─────────────────────────────────────────────────── */

/**
 * Has this delivery already been handled?
 *
 * Stripe retries, Google delivers duplicates while two channels overlap during
 * renewal, and Graph retries for up to four hours. Every handler is idempotent
 * or it is wrong.
 *
 * Lives in the directory because a Stripe event is not scoped to a user we
 * have resolved yet.
 */
export async function alreadyProcessed(
  directory: Directory,
  source: "stripe" | "google" | "microsoft",
  eventId: string,
  now: number,
): Promise<boolean> {
  const id = `${source}:${eventId}`;
  const seen = await directory.processedEvent.findUnique({
    where: { id },
    select: { id: true },
  });
  if (seen) return true;

  await directory.processedEvent.create({
    data: { id, source, processedAt: at(now) },
  });
  return false;
}

export async function pruneProcessedEvents(
  directory: Directory,
  before: number,
): Promise<void> {
  await directory.processedEvent.deleteMany({
    where: { processedAt: { lte: at(before) } },
  });
}
