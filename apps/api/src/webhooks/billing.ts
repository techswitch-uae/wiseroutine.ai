import { type Directory, findUserByStripeCustomer, getSubscription, processWebhook, upsertSubscription } from "@wiseroutine/db";
import type Stripe from "stripe";

/** Deliveries are hints, not ordered subscription snapshots. Fetch Stripe's
 * current object while holding our writer lock so late/duplicate events never
 * restore an old entitlement. Fetch or persistence failure rolls back the
 * consumption marker as well as all local subscription/plan writes. */
export async function applyBillingEvent(
  directory: Directory,
  stripe: Pick<Stripe, "subscriptions">,
  event: Stripe.Event,
  now: number,
): Promise<boolean> {
  return processWebhook(directory, "stripe", event.id, now, async (tx) => {
    let subscriptionId: string | null = null;
    let userId: string | undefined;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      userId = session.client_reference_id ?? undefined;
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const subscription = event.data.object as Stripe.Subscription;
      subscriptionId = subscription.id;
      userId = subscription.metadata?.userId;
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customer) userId = await findUserByStripeCustomer(tx, customer);
      const source = invoice.parent?.subscription_details?.subscription;
      subscriptionId = typeof source === "string" ? source : source?.id ?? null;
      if (!subscriptionId && userId) subscriptionId = (await getSubscription(tx, userId))?.stripeSubscriptionId ?? null;
    } else return;

    if (!subscriptionId) return;
    let current = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = typeof current.customer === "string" ? current.customer : current.customer.id;
    userId ??= current.metadata?.userId || await findUserByStripeCustomer(tx, customerId);
    if (!userId) throw new Error("Subscription delivery has no user mapping yet");
    const previous = await getSubscription(tx, userId);
    if (previous?.stripeSubscriptionId && previous.stripeSubscriptionId !== current.id) {
      const existing = await stripe.subscriptions.retrieve(previous.stripeSubscriptionId);
      // An old cancellation must not replace a newer subscription belonging
      // to the same customer. Both objects are authoritative, not snapshots.
      if (existing.created >= current.created) current = existing;
    }
    const item = current.items.data[0];
    await upsertSubscription(tx, {
      userId,
      stripeCustomerId: typeof current.customer === "string" ? current.customer : current.customer.id,
      stripeSubscriptionId: current.id,
      stripePriceId: item?.price.id ?? null,
      status: current.status,
      currentPeriodEnd: item?.current_period_end ? item.current_period_end * 1000 : null,
      cancelAtPeriodEnd: current.cancel_at_period_end,
    }, now);
  });
}
