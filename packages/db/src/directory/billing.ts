import { at, atOrNull, type Directory, directoryTransaction, isTransaction } from "../client";
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
): Promise<Awaited<ReturnType<typeof refreshUserPlan>>> {
  if (!isTransaction(directory)) return directoryTransaction(directory, (tx) =>
    upsertSubscription(tx, input, now));
  const data = {
    stripeCustomerId: input.stripeCustomerId,
    ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
    ...(input.stripePriceId !== undefined ? { stripePriceId: input.stripePriceId } : {}),
    status: input.status,
    ...(input.currentPeriodEnd !== undefined ? { currentPeriodEnd: atOrNull(input.currentPeriodEnd) } : {}),
    ...(input.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd } : {}),
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
export async function processWebhook(
  directory: Directory,
  source: "stripe" | "google" | "microsoft",
  eventId: string,
  now: number,
  apply: (tx: Directory) => Promise<void>,
): Promise<boolean> {
  return directoryTransaction(directory, async (tx) => {
    const id = `${source}:${eventId}`;
    if (await tx.processedEvent.findUnique({ where: { id } })) return false;
    await apply(tx);
    await tx.processedEvent.create({ data: { id, source, processedAt: at(now) } });
    return true;
  });
}

export async function pruneProcessedEvents(
  directory: Directory,
  before: number,
): Promise<void> {
  await directory.processedEvent.deleteMany({
    where: { processedAt: { lte: at(before) } },
  });
}
