import {
  type Directory,
  getSyncState,
  registerWatch,
  saveSyncState,
  scheduleWork,
  unregisterWatch,
} from "@wiseroutine/db";
import {
  googleStopChannel,
  googleWatch,
  microsoftRenewSubscription,
  microsoftSubscribe,
} from "@wiseroutine/providers";
import { generateToken } from "../crypto";
import { accessTokenFor, type SyncDeps, type SyncTarget } from "./engine";

/**
 * Push channels: opening them, and keeping them open.
 *
 * Without this, every webhook handler in `src/webhooks/` is unreachable -
 * nothing tells Google or Graph where to deliver. And a channel that is opened
 * once is not enough: neither provider lets one live for long, so a calendar
 * that is never renewed simply stops reporting changes after a few days, with
 * no error anywhere. The 15-minute poll would still catch up eventually, which
 * is exactly what makes the failure invisible.
 */

/** Google caps a calendar channel at 7 days. */
const GOOGLE_TTL_MS = 7 * 86_400_000;

/**
 * Graph caps an event subscription at 4230 minutes - just under three days.
 * Asking for more is rejected outright, so this stays a little under.
 */
const GRAPH_TTL_MS = 4_200 * 60_000;

/**
 * Renew this far before expiry.
 *
 * Generous on purpose: a renewal is one API call, while missing the window
 * means a silent gap until the next poll. Google has no renewal API at all -
 * renewing is opening a new channel and stopping the old one - so there is an
 * overlap where both deliver. `alreadyProcessed` and the sync token make that
 * harmless.
 */
const RENEW_BEFORE_MS = 12 * 3_600_000;

export interface WatchDeps extends SyncDeps {
  directory: Directory;
  /** Public origin the provider must be able to reach. */
  apiUrl: string;
}

/**
 * Make sure this calendar has a live push channel, and say when to look again.
 *
 * Safe to call repeatedly: an existing channel with time left is left alone,
 * so this can run on connect, on selection and on every renewal tick without
 * churning subscriptions.
 */
export async function ensureWatch(
  deps: WatchDeps,
  target: SyncTarget,
  now: number,
  newId: () => string,
): Promise<number> {
  const state = await getSyncState(deps.db, target.calendarId);
  const expiresAt = state?.watchExpiresAt ?? 0;

  if (expiresAt > now + RENEW_BEFORE_MS) return expiresAt - RENEW_BEFORE_MS;

  const accessToken = await accessTokenFor(
    deps,
    target.connectionId,
    target.provider,
    now,
  );

  const next =
    target.provider === "google"
      ? await openGoogleChannel(deps, target, accessToken, state, newId)
      : await openGraphSubscription(deps, target, accessToken, state, now);

  await registerWatch(
    deps.directory,
    {
      channelId: next.channelId,
      userId: deps.userId,
      calendarId: target.calendarId,
      provider: target.provider,
      secret: next.secret,
      expiresAt: next.expiresAt,
    },
    now,
  );

  await saveSyncState(deps.db, target.calendarId, {
    watchChannelId: next.channelId,
    watchResourceId: next.resourceId,
    watchSecret: next.secret,
    watchExpiresAt: next.expiresAt,
  });

  // The renewal has to be owed somewhere the ticker can see it, or the channel
  // expires and the pushes stop without anything noticing.
  const renewAt = next.expiresAt - RENEW_BEFORE_MS;
  await scheduleWork(
    deps.directory,
    {
      userId: deps.userId,
      kind: "renew_watch",
      targetId: target.calendarId,
      dueAt: renewAt,
    },
    now,
    newId,
  );

  return renewAt;
}

interface OpenedChannel {
  channelId: string;
  resourceId: string | null;
  secret: string;
  expiresAt: number;
}

async function openGoogleChannel(
  deps: WatchDeps,
  target: SyncTarget,
  accessToken: string,
  previous: Awaited<ReturnType<typeof getSyncState>>,
  newId: () => string,
): Promise<OpenedChannel> {
  const channelId = newId();
  const secret = generateToken();

  const opened = await googleWatch({
    accessToken,
    calendarId: target.providerCalendarId,
    channelId,
    address: `${deps.apiUrl}/webhooks/google`,
    // Echoed back as X-Goog-Channel-Token, which is the webhook's only
    // authentication - so it holds this opaque value and nothing else.
    token: secret,
    ttlSeconds: GOOGLE_TTL_MS / 1000,
  });

  // Only now that the replacement exists. Stopping first would leave a window
  // with no channel at all if the new one failed to open.
  if (previous?.watchChannelId && previous.watchResourceId) {
    await googleStopChannel({
      accessToken,
      channelId: previous.watchChannelId,
      resourceId: previous.watchResourceId,
    }).catch(() => undefined);
    await unregisterWatch(deps.directory, previous.watchChannelId);
  }

  return {
    channelId,
    resourceId: opened.resourceId,
    secret,
    expiresAt: opened.expiration,
  };
}

async function openGraphSubscription(
  deps: WatchDeps,
  target: SyncTarget,
  accessToken: string,
  state: Awaited<ReturnType<typeof getSyncState>>,
  now: number,
): Promise<OpenedChannel> {
  const expiresAt = now + GRAPH_TTL_MS;

  // Graph *does* have a renewal API, so an existing subscription is extended
  // rather than replaced - no overlap window, and the delta token survives.
  if (state?.watchChannelId && state.watchSecret) {
    try {
      await microsoftRenewSubscription({
        accessToken,
        subscriptionId: state.watchChannelId,
        expiresAt,
      });
      return {
        channelId: state.watchChannelId,
        resourceId: null,
        secret: state.watchSecret,
        expiresAt,
      };
    } catch {
      // Graph removes subscriptions it considers dead, and renewing one of
      // those is a 404. Fall through and make a new one.
      await unregisterWatch(deps.directory, state.watchChannelId);
    }
  }

  const secret = generateToken();
  const created = await microsoftSubscribe({
    accessToken,
    calendarId: target.providerCalendarId,
    notificationUrl: `${deps.apiUrl}/webhooks/microsoft`,
    // Without this, a dropped notification is unrecoverable: `missed` on the
    // lifecycle endpoint is the only signal Graph gives that it lost changes.
    lifecycleNotificationUrl: `${deps.apiUrl}/webhooks/microsoft/lifecycle`,
    clientState: secret,
    expiresAt,
  });

  return {
    channelId: created.subscriptionId,
    resourceId: null,
    secret,
    expiresAt: created.expiresAt,
  };
}

/**
 * Close a calendar's channel.
 *
 * Called when a calendar is deselected or a connection goes away. Leaving one
 * open would keep the provider delivering notifications for data we no longer
 * hold, and each one costs a directory lookup to discover it is unwanted.
 */
export async function stopWatch(
  deps: WatchDeps,
  target: SyncTarget,
  now: number,
): Promise<void> {
  const state = await getSyncState(deps.db, target.calendarId);
  if (!state?.watchChannelId) return;

  // Best effort by design: the row is what routes deliveries, so removing it
  // is what matters. A channel we failed to stop expires on its own, and its
  // notifications resolve to nothing in the meantime.
  try {
    const accessToken = await accessTokenFor(
      deps,
      target.connectionId,
      target.provider,
      now,
    );

    if (target.provider === "google" && state.watchResourceId) {
      await googleStopChannel({
        accessToken,
        channelId: state.watchChannelId,
        resourceId: state.watchResourceId,
      });
    }
  } catch {
    // Nothing to do: the cleanup below is the part that has to happen.
  }

  await unregisterWatch(deps.directory, state.watchChannelId);
  await saveSyncState(deps.db, target.calendarId, {
    watchChannelId: null,
    watchResourceId: null,
    watchSecret: null,
    watchExpiresAt: null,
  });
}
