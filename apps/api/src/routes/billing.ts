import { getSubscription } from "@wiseroutine/db";
import { required } from "@wiseroutine/env";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type Stripe from "stripe";
import { type App, proOfferEnabled, requireUser } from "../context";
import { stripeClient } from "../stripe";

export const billing = new Hono<App>();
billing.use("*", requireUser);

billing.get("/", async (c) => {
  const subscription = await getSubscription(
    c.get("directory"),
    c.get("user").userId,
  );
  return c.json({
    plan: c.get("user").plan,
    offerEnabled: await proOfferEnabled(c),
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
  });
});

/**
 * Start a checkout.
 *
 * The kill switch lives here, on the sales path only. Turning the offer off
 * stops new purchases; it never touches an existing subscription or a beta
 * grant, because revoking paid access is a refund and a support incident.
 */
billing.post("/checkout", async (c) => {
  if (!(await proOfferEnabled(c))) {
    throw new HTTPException(403, {
      message: "The Pro plan is not currently open for signup",
    });
  }

  const env = c.get("env");
  const stripe = stripeClient(env);
  const existing = await getSubscription(
    c.get("directory"),
    c.get("user").userId,
  );

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: required(env.STRIPE_PRO_PRICE_ID, "STRIPE_PRO_PRICE_ID"),
        quantity: 1,
      },
    ],
    ...(existing ? { customer: existing.stripeCustomerId } : {}),
    client_reference_id: c.get("user").userId,
    // The desktop app cannot host a redirect, so checkout opens in the system
    // browser and returns through the app's deep-link scheme.
    success_url: `${env.APP_URL}/billing/complete?status=success`,
    cancel_url: `${env.APP_URL}/billing/complete?status=cancelled`,
    subscription_data: { metadata: { userId: c.get("user").userId } },
  });

  return c.json({ url: session.url });
});

billing.post("/portal", async (c) => {
  const env = c.get("env");
  const subscription = await getSubscription(
    c.get("directory"),
    c.get("user").userId,
  );
  if (!subscription)
    throw new HTTPException(404, { message: "No subscription" });

  const stripe: Stripe = stripeClient(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.APP_URL}/billing/complete?status=portal`,
  });

  return c.json({ url: session.url });
});
