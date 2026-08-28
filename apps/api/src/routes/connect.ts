import {
  saveTokens,
  scheduleWork,
  upsertCalendars,
  upsertConnection,
} from "@wiseroutine/db";
import { required } from "@wiseroutine/env";
import {
  decodeIdToken,
  googleAuthorizeUrl,
  googleExchangeCode,
  googleListCalendars,
  microsoftAdminConsentUrl,
  microsoftAuthorizeUrl,
  microsoftExchangeCode,
  microsoftListCalendars,
  needsAdminConsent,
  ProviderError,
} from "@wiseroutine/providers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type App, newId, requireUser, rootKey } from "../context";
import { generateToken, seal } from "../crypto";
import { createUserDb } from "../env";
import { ensureWatch, type WatchDeps } from "../sync/watch";

/**
 * Connecting a calendar.
 *
 * Sign-in is an emailed code (`src/auth.ts`); this is a *later*, optional act
 * by someone already signed in. Keeping them apart is what lets a user exist
 * before Google has approved anything, and it keeps provider refresh tokens in
 * the user's own database - Better Auth would have put them in the shared
 * directory.
 */
export const connect = new Hono<App>();

const STATE_TTL_SECONDS = 600;

type Provider = "google" | "microsoft";

function parseProvider(value: string): Provider {
  if (value !== "google" && value !== "microsoft") {
    throw new HTTPException(404, { message: "Unknown provider" });
  }
  return value;
}

function redirectUri(apiUrl: string, provider: Provider): string {
  return `${apiUrl}/connect/${provider}/callback`;
}

/**
 * Mint a consent URL for the signed-in user.
 *
 * A POST that *returns* a URL rather than a redirect, because the caller has
 * to be authenticated: the desktop app opens the result in the system browser,
 * where no authorization header would survive. Which account the calendar
 * attaches to is decided here, from the session, and carried in server-side
 * state - never in a query parameter the caller could change.
 */
connect.post("/:provider/start", requireUser, async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const env = c.get("env");
  const state = generateToken();

  await c.env.CONFIG.put(
    `oauth_state:${state}`,
    JSON.stringify({ provider, userId: c.get("user").userId }),
    { expirationTtl: STATE_TTL_SECONDS },
  );

  const url =
    provider === "google"
      ? googleAuthorizeUrl({
          clientId: required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
          redirectUri: redirectUri(env.API_URL, provider),
          state,
        })
      : microsoftAuthorizeUrl({
          clientId: required(env.MICROSOFT_CLIENT_ID, "MICROSOFT_CLIENT_ID"),
          redirectUri: redirectUri(env.API_URL, provider),
          state,
        });

  return c.json({ url });
});

connect.get("/:provider/callback", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const code = c.req.query("code");
  const state = c.req.query("state");
  const env = c.get("env");
  const done = new URL(`${env.APP_URL}/auth/complete`);

  // The provider can refuse before we ever get a code. The refusal worth
  // handling specially is a tenant that disables user consent: the user has
  // done nothing wrong and an administrator can unblock them, so send the
  // consent link rather than a dead end.
  const providerError =
    c.req.query("error_description") ?? c.req.query("error");
  if (providerError) {
    if (provider === "microsoft" && needsAdminConsent(providerError)) {
      done.searchParams.set("error", "admin_consent_required");
      done.searchParams.set(
        "consentUrl",
        microsoftAdminConsentUrl({
          clientId: env.MICROSOFT_CLIENT_ID ?? "",
          redirectUri: redirectUri(env.API_URL, "microsoft"),
          state: state ?? "",
        }),
      );
    } else {
      done.searchParams.set("error", "consent_denied");
    }
    return c.redirect(done.toString());
  }

  if (!code || !state) {
    throw new HTTPException(400, { message: "Missing code or state" });
  }

  const stored = await c.env.CONFIG.get(`oauth_state:${state}`);
  if (!stored) {
    throw new HTTPException(400, { message: "Expired or unknown state" });
  }
  await c.env.CONFIG.delete(`oauth_state:${state}`);
  const { userId } = JSON.parse(stored) as { userId: string };

  const user = await c
    .get("directory")
    .user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new HTTPException(404, { message: "Unknown account" });
  }

  const now = c.get("now");
  const tokens =
    provider === "google"
      ? await googleExchangeCode({
          code,
          clientId: required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
          clientSecret: required(
            env.GOOGLE_CLIENT_SECRET,
            "GOOGLE_CLIENT_SECRET",
          ),
          redirectUri: redirectUri(env.API_URL, provider),
        })
      : await microsoftExchangeCode({
          code,
          clientId: required(env.MICROSOFT_CLIENT_ID, "MICROSOFT_CLIENT_ID"),
          clientSecret: required(
            env.MICROSOFT_CLIENT_SECRET,
            "MICROSOFT_CLIENT_SECRET",
          ),
          redirectUri: redirectUri(env.API_URL, provider),
        });

  const claims = tokens.idToken ? decodeIdToken(tokens.idToken) : {};
  const providerAccountId = String(claims.sub ?? claims.oid ?? "");
  const email = String(claims.email ?? claims.preferred_username ?? "");
  if (!providerAccountId || !email) {
    throw new HTTPException(400, {
      message: "Provider did not return an identity",
    });
  }

  const db = createUserDb(env, user.databaseName);

  const connectionId = await upsertConnection(
    db,
    { provider, providerAccountId, email, scopes: tokens.scope ?? "" },
    now,
    newId,
  );

  // Refresh tokens never leave the server, and never in plaintext.
  const key = rootKey(c);
  const sealedAccess = await seal(key, userId, tokens.accessToken);
  const sealedRefresh = tokens.refreshToken
    ? await seal(key, userId, tokens.refreshToken)
    : undefined;

  await saveTokens(
    db,
    connectionId,
    {
      accessTokenCiphertext: sealedAccess.ciphertext,
      accessTokenIv: sealedAccess.iv,
      refreshTokenCiphertext: sealedRefresh?.ciphertext ?? null,
      refreshTokenIv: sealedRefresh?.iv ?? null,
      keyVersion: sealedAccess.keyVersion,
      expiresAt: tokens.expiresAt,
    },
    now,
  );

  /**
   * The first call that actually uses the grant - and the first that can fail
   * for reasons the user did nothing to cause: an API not enabled on the
   * project, a quota, a provider outage.
   *
   * Unhandled, it threw out of the callback and Google's browser tab landed on
   * a raw 500 - after the user had already granted access, which is the worst
   * possible moment to show someone a stack of JSON. The tokens are saved by
   * this point, so retrying re-uses the same connection row and repairs it;
   * what matters here is that the user is told, in the app, that it did not
   * finish. The reason goes to the log, where the person who can fix it looks.
   */
  let calendars: Awaited<ReturnType<typeof googleListCalendars>>;
  try {
    calendars =
      provider === "google"
        ? await googleListCalendars(tokens.accessToken)
        : await microsoftListCalendars(tokens.accessToken);
  } catch (error) {
    console.error("listing calendars failed", provider, error);
    done.searchParams.set("error", "calendar_unavailable");
    done.searchParams.set("connected", provider);
    return c.redirect(done.toString());
  }

  const calendarIds = await upsertCalendars(
    db,
    calendars.map((cal) => ({ connectionId, ...cal })),
    now,
    newId,
  );

  /**
   * Owe a first sync for every calendar we just took on.
   *
   * Nothing else was doing this. `upsertCalendars` marks them selected, but
   * the only places that schedule `sync_calendar` are the selection toggle,
   * the push webhooks, and the foreground middleware - and that last one is
   * deliberately debounced by `shouldSyncOnForeground`, so an active user
   * whose `lastSeenAt` was just touched does not trigger it. The result was a
   * calendar that connected successfully, reported success, and then showed
   * nothing until the sync interval happened to elapse.
   *
   * The directory row is the durable "this is owed"; the queue message is the
   * nudge that gets it done now rather than at the next tick. Same pairing as
   * `markForeground` and the webhooks.
   */
  for (const calendarId of calendarIds) {
    await scheduleWork(
      c.get("directory"),
      {
        userId,
        kind: "sync_calendar",
        targetId: calendarId,
        dueAt: now,
      },
      now,
      newId,
    );

    await c.env.SYNC_QUEUE.send({
      type: "sync-calendar",
      workId: "",
      userId,
      databaseName: user.databaseName,
      targetId: calendarId,
      reason: "connected",
    });
  }

  // Open the push channels now, while we hold a fresh access token and the
  // user is watching a page that can report a failure. Without this the
  // webhook handlers are unreachable and every change waits for the poll.
  const watchDeps: WatchDeps = {
    db,
    userId,
    rootKey: key,
    clientIds: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      },
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID ?? "",
        clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
      },
    },
    directory: c.get("directory"),
    apiUrl: env.API_URL,
  };

  for (const [index, calendarId] of calendarIds.entries()) {
    const source = calendars[index];
    if (!source) continue;

    // One calendar refusing a channel must not fail the connection - the rest
    // still work, and the renewal tick retries this one.
    try {
      await ensureWatch(
        watchDeps,
        {
          calendarId,
          connectionId,
          provider,
          providerCalendarId: source.providerCalendarId,
          storeTitles: user.storeEventTitles,
        },
        now,
        newId,
      );
    } catch (error) {
      // Google refuses to push to anything but HTTPS, so a channel can never
      // open against `http://localhost`. That is the expected state of every
      // local machine, not a fault - and a stack trace here reads like the
      // connection broke when it did not. Sync still runs on the ticker.
      if (
        error instanceof ProviderError &&
        error.body.includes("webhookUrlNotHttps")
      ) {
        console.info(
          `push channel skipped for ${provider}: the provider requires an HTTPS webhook, and this environment is ${env.API_URL}. Calendars still sync on the poll ticker.`,
        );
      } else {
        console.error("watch failed", provider, calendarId, error);
      }
    }
  }

  done.searchParams.set("connected", provider);
  return c.redirect(done.toString());
});
