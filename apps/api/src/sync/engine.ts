import {
  getSyncState,
  getTokens,
  markNeedsReauth,
  saveSyncState,
  saveTokens,
  tombstoneEvents,
  type UserDatabase,
  upsertEvents,
} from "@wiseroutine/db";
import {
  googleRefresh,
  googleSyncPage,
  microsoftRefresh,
  microsoftSyncPage,
  type NormalisedEvent,
  ProviderError,
  SyncTokenExpired,
} from "@wiseroutine/providers";
import { open, seal } from "../crypto";

/** How far either side of today we keep concrete event instances. Chosen once:
 *  on Google the window is baked into the sync token forever, so changing it
 *  later forces a full resync of every calendar. */
export const WINDOW_BEHIND_DAYS = 7;
export const WINDOW_AHEAD_DAYS = 60;

/** Graph freezes the window inside the delta token, so the far edge creeps
 *  closer as real time advances. Rebuild before it runs out. */
export const REBASELINE_AFTER_DAYS = 21;

const DAY = 86_400_000;

export interface SyncDeps {
  /** The user's own database. */
  db: UserDatabase;
  /** Envelope-encryption keys are per user, so the id is part of the context. */
  userId: string;
  rootKey: string;
  clientIds: {
    google: { clientId: string; clientSecret: string };
    microsoft: { clientId: string; clientSecret: string };
  };
}

export interface SyncTarget {
  calendarId: string;
  connectionId: string;
  provider: "google" | "microsoft";
  providerCalendarId: string;
  storeTitles: boolean;
}

export interface SyncOutcome {
  written: number;
  skipped: number;
  deleted: number;
  fullResync: boolean;
  pages: number;
}

/**
 * A valid access token for a connection, refreshing if it is close to expiry.
 *
 * Refreshes 60 s early so a token cannot expire mid-sync, and re-seals the new
 * refresh token when the provider rotates it (Microsoft always does).
 */
export async function accessTokenFor(
  deps: SyncDeps,
  connectionId: string,
  provider: "google" | "microsoft",
  now: number,
): Promise<string> {
  const stored = await getTokens(deps.db, connectionId);
  /**
   * A connection with no token row at all.
   *
   * The connection and its tokens are two writes, and only the first one is
   * guaranteed to have happened: `/connect/:provider/callback` upserts the
   * connection, then seals two tokens and saves them. A throw or an eviction
   * between the two leaves a row that says "active" with nothing behind it.
   *
   * Marked, not merely thrown - the same as a missing refresh token below.
   * Left active it is a connection nobody can repair and nothing gives up on:
   * `runSyncJob` retries anything still active, the backoff caps at six hours
   * and never ends, Calendars goes on reporting "Reading 2 of 4 calendars",
   * and the only trace is a line in a log the user cannot see. Needing a
   * reconnection is exactly what this is, and it is the one state the UI
   * already offers a way out of.
   */
  if (!stored) {
    await markNeedsReauth(deps.db, connectionId);
    throw new Error(`No tokens for connection ${connectionId}`);
  }

  if (stored.expiresAt > now + 60_000) {
    return open(deps.rootKey, deps.userId, {
      ciphertext: stored.accessTokenCiphertext,
      iv: stored.accessTokenIv,
      keyVersion: stored.keyVersion,
    });
  }

  if (!stored.refreshTokenCiphertext || !stored.refreshTokenIv) {
    await markNeedsReauth(deps.db, connectionId);
    throw new Error("No refresh token; reconnection required");
  }

  const refreshToken = await open(deps.rootKey, deps.userId, {
    ciphertext: stored.refreshTokenCiphertext,
    iv: stored.refreshTokenIv,
    keyVersion: stored.keyVersion,
  });

  const credentials = deps.clientIds[provider];
  const refreshed =
    provider === "google"
      ? await googleRefresh({ refreshToken, ...credentials })
      : await microsoftRefresh({ refreshToken, ...credentials });

  const sealedAccess = await seal(
    deps.rootKey,
    deps.userId,
    refreshed.accessToken,
  );
  const sealedRefresh = refreshed.refreshToken
    ? await seal(deps.rootKey, deps.userId, refreshed.refreshToken)
    : undefined;

  await saveTokens(
    deps.db,
    connectionId,
    {
      accessTokenCiphertext: sealedAccess.ciphertext,
      accessTokenIv: sealedAccess.iv,
      refreshTokenCiphertext:
        sealedRefresh?.ciphertext ?? stored.refreshTokenCiphertext,
      refreshTokenIv: sealedRefresh?.iv ?? stored.refreshTokenIv,
      keyVersion: sealedAccess.keyVersion,
      expiresAt: refreshed.expiresAt,
    },
    now,
  );

  return refreshed.accessToken;
}

/**
 * Sync one calendar.
 *
 * The loop is the same for both providers: page until the provider hands back a
 * token, write only what changed, then persist the token. Google's
 * `nextSyncToken` arrives **only on the last page**, so this must run to
 * completion - which is why it lives in a queue consumer rather than a request
 * handler, where a CPU limit could truncate it and silently force a full
 * resync every time.
 */
export async function syncCalendar(
  deps: SyncDeps,
  target: SyncTarget,
  now: number,
  newId: () => string,
): Promise<SyncOutcome> {
  const accessToken = await accessTokenFor(
    deps,
    target.connectionId,
    target.provider,
    now,
  );
  const state = await getSyncState(deps.db, target.calendarId);

  const stale =
    state?.windowRebasedAt != null &&
    now - state.windowRebasedAt > REBASELINE_AFTER_DAYS * DAY;

  const token = stale ? undefined : (state?.syncToken ?? undefined);
  const link = stale ? undefined : (state?.deltaLink ?? undefined);
  const fullResync = token === undefined && link === undefined;

  const outcome: SyncOutcome = {
    written: 0,
    skipped: 0,
    deleted: 0,
    fullResync,
    pages: 0,
  };

  const timeMin = new Date(now - WINDOW_BEHIND_DAYS * DAY).toISOString();
  const timeMax = new Date(now + WINDOW_AHEAD_DAYS * DAY).toISOString();

  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const collected: NormalisedEvent[] = [];
  const deleted: string[] = [];

  try {
    // Bounded so a pathological calendar cannot spin forever inside one job.
    for (let page = 0; page < 40; page++) {
      const result =
        target.provider === "google"
          ? await googleSyncPage({
              accessToken,
              calendarId: target.providerCalendarId,
              syncToken: token,
              timeMin,
              timeMax,
              pageToken,
            })
          : await microsoftSyncPage({
              accessToken,
              calendarId: target.providerCalendarId,
              link: pageToken ?? link,
              startDateTime: timeMin,
              endDateTime: timeMax,
            });

      collected.push(...result.events);
      deleted.push(...result.deletedIds);
      outcome.pages++;

      if (result.nextSyncToken) {
        nextSyncToken = result.nextSyncToken;
        break;
      }
      if (!result.nextPageToken) break;
      pageToken = result.nextPageToken;
    }
  } catch (error) {
    if (error instanceof SyncTokenExpired) {
      // Expected, not exceptional: an ACL change or an evicted token. Clear and
      // start over on the next pass rather than failing the job.
      await saveSyncState(deps.db, target.calendarId, {
        syncToken: null,
        deltaLink: null,
        windowRebasedAt: now,
      });
      return { ...outcome, fullResync: true };
    }
    if (error instanceof ProviderError && error.needsReauth) {
      await markNeedsReauth(deps.db, target.connectionId);
    }
    throw error;
  }

  const upserted = await upsertEvents(
    deps.db,
    { calendarId: target.calendarId, storeTitles: target.storeTitles },
    collected,
    now,
    newId,
  );
  outcome.written = upserted.written;
  outcome.skipped = upserted.skipped;

  if (deleted.length > 0) {
    await tombstoneEvents(deps.db, target.calendarId, deleted, now);
    outcome.deleted = deleted.length;
  }

  await saveSyncState(deps.db, target.calendarId, {
    ...(target.provider === "google"
      ? { syncToken: nextSyncToken ?? state?.syncToken ?? null }
      : { deltaLink: nextSyncToken ?? state?.deltaLink ?? null }),
    lastIncrementalAt: now,
    ...(fullResync ? { lastFullSyncAt: now, windowRebasedAt: now } : {}),
    consecutiveFailures: 0,
    syncGeneration: (state?.syncGeneration ?? 0) + 1,
  });

  return outcome;
}
