import { required } from "@wiseroutine/env";
import Stripe from "stripe";
import type { ServerEnv } from "./env";

/**
 * A Stripe client that works on Workers.
 *
 * `createFetchHttpClient` is mandatory - the SDK otherwise reaches for Node's
 * `http`, which does not exist here.
 */
export function stripeClient(env: ServerEnv): Stripe {
  return new Stripe(required(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"), {
    apiVersion: "2026-07-29.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Verify a webhook signature.
 *
 * Must be the async variant: the synchronous `constructEvent` uses node:crypto
 * and throws on Workers. This is the single most common Stripe-on-Workers bug.
 */
export function constructStripeEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  secret: string,
): Promise<Stripe.Event> {
  return stripe.webhooks.constructEventAsync(
    rawBody,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
