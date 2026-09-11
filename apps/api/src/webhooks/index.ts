import {
  findWatchRoute,
  getUser,
  scheduleWork,
} from "@wiseroutine/db";
import { required } from "@wiseroutine/env";
import { Hono } from "hono";
import type Stripe from "stripe";
import { type App, type Ctx, newId } from "../context";
import { safeEqual } from "../crypto";
import { constructStripeEvent, stripeClient } from "../stripe";
import { applyBillingEvent } from "./billing";

export const webhooks = new Hono<App>();

/**
 * Turning a push notification into queued work.
 *
 * With one database per user, a webhook cannot act directly: it only knows a
 * channel id. The directory maps that to a user, and the queue consumer opens
 * their database. Enqueue and return - never do provider work inline.
 */
async function enqueueFromChannel(
  c: Ctx,
  channelId: string,
  secret: string,
  reason: string,
): Promise<"ok" | "unknown" | "forbidden"> {
  const route = await findWatchRoute(c.get("directory"), channelId);
  if (!route) return "unknown";
  if (!safeEqual(secret, route.secret)) return "forbidden";

  const user = await getUser(c.get("directory"), route.userId);
  if (!user) return "unknown";

  await scheduleWork(
    c.get("directory"),
    {
      userId: route.userId,
      kind: "sync_calendar",
      targetId: route.calendarId,
      dueAt: c.get("now"),
    },
    c.get("now"),
    newId,
  );

  await c.env.SYNC_QUEUE.send({
    type: "sync-calendar",
    workId: "",
    userId: route.userId,
    databaseName: user.databaseName,
    targetId: route.calendarId,
    reason,
  });

  return "ok";
}

/* ── Google Calendar push ────────────────────────────────────────────────── */

/**
 * Google notifications carry **no body and no information about what changed** -
 * everything is in headers. Treat one as "something changed, go run the sync
 * loop", never as data.
 *
 * There is no signature. `X-Goog-Channel-Token` is the only authentication, so
 * it holds an opaque per-channel secret and nothing else (Google's own docs
 * warn against putting real tokens there).
 */
webhooks.post("/google", async (c) => {
  const channelId = c.req.header("x-goog-channel-id");
  const token = c.req.header("x-goog-channel-token") ?? "";
  const state = c.req.header("x-goog-resource-state");
  if (!channelId) return c.body(null, 400);

  // The first message after opening a channel is a handshake, not a change.
  // It can even arrive before the watch call returns, so an unknown channel is
  // not necessarily an error.
  if (state === "sync") return c.body(null, 200);

  const result = await enqueueFromChannel(c, channelId, token, "google_push");
  if (result === "forbidden") return c.body(null, 401);
  return c.body(null, 200);
});

/* ── Microsoft Graph change notifications ────────────────────────────────── */

/**
 * Graph is far stricter than Google:
 *
 *  - creating a subscription triggers a challenge-response that must be
 *    answered within 10 s as plain text
 *  - every real notification must get a 2xx within **3 seconds**. Exceed 3 s on
 *    >10% of deliveries in a 10-minute window and delivery is delayed;
 *    exceed 10 s on >15% and notifications are dropped unrecoverably
 *
 * So: validate, enqueue, return 202. Nothing that talks to Graph happens here.
 */
webhooks.post("/microsoft", async (c) => {
  const validationToken = c.req.query("validationToken");
  if (validationToken) {
    // Answered before touching storage, so the handshake cannot time out.
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  type GraphBody = { value?: Record<string, unknown>[] };
  const body: GraphBody = await c.req
    .json<GraphBody>()
    .catch(() => ({}) as GraphBody);

  for (const notification of body.value ?? []) {
    const clientState = String(notification.clientState ?? "");
    const subscriptionId = String(notification.subscriptionId ?? "");
    if (!subscriptionId) continue;
    await enqueueFromChannel(c, subscriptionId, clientState, "graph_push");
  }

  return c.body(null, 202);
});

/**
 * Lifecycle events - the difference between a sync that recovers and one that
 * dies in silence.
 *
 *  - `missed`: Graph knows it dropped changes. The only signal we get.
 *  - `reauthorizationRequired`: the token expired before the subscription did.
 *  - `subscriptionRemoved`: Graph killed it; recreate.
 */
webhooks.post("/microsoft/lifecycle", async (c) => {
  const validationToken = c.req.query("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  type GraphBody = { value?: Record<string, unknown>[] };
  const body: GraphBody = await c.req
    .json<GraphBody>()
    .catch(() => ({}) as GraphBody);

  for (const notification of body.value ?? []) {
    const subscriptionId = String(notification.subscriptionId ?? "");
    const clientState = String(notification.clientState ?? "");
    if (!subscriptionId) continue;

    // Every lifecycle event resolves to the same recovery: go and sync now.
    await enqueueFromChannel(
      c,
      subscriptionId,
      clientState,
      `graph_lifecycle:${String(notification.lifecycleEvent ?? "unknown")}`,
    );
  }

  return c.body(null, 202);
});

/* ── Stripe ──────────────────────────────────────────────────────────────── */

webhooks.post("/stripe", async (c) => {
  const env = c.get("env");
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.body(null, 400);

  const rawBody = await c.req.text();
  const stripe = stripeClient(env, true);

  let event: Stripe.Event;
  try {
    event = await constructStripeEvent(
      stripe,
      rawBody,
      signature,
      required(env.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return c.body(null, 400);
  }

  const directory = c.get("directory");
  const now = c.get("now");

  const applied = await applyBillingEvent(directory, stripe, event, now);
  return c.json({ received: true, duplicate: !applied });
});
