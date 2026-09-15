# Desktop social sign-in handoff

The app opens Google/Outlook consent in the system browser. A browser cookie is not enough to authorize delivery of that session to an app.

## Implemented protocol

1. `POST /signin/social/start` creates a short-lived directory record. The app retains a random **claim secret** (`ticket`); the browser URL carries a separate random **attempt ID**. Only the claim secret's SHA-256 hash is stored in that record.
2. `/social/go?attempt=…` atomically changes a pending attempt to started and mints a private completion proof. A second start is refused. This browser navigation receives Better Auth's signed state cookie.
3. A server-only Better Auth before hook attaches the proof using `addOAuthServerContext`. Client `additionalData`, callback parameters and headers cannot supply this context. The proof is never placed in a browser URL.
4. The after hook runs on the provider callback, after Better Auth validates OAuth state/cookie, authorization code and identity. It requires the matching provider and proof and uses **only the newly created callback session**, never `getSession()` from an existing browser login.
5. A conditional database update moves an unexpired started attempt to ready or failed. Replays cannot overwrite completed records or resurrect consumed ones. Verified provider refusals are returned to the waiting app without publishing a session.
6. `/social/claim` consumes terminal results in a directory writer transaction. Simultaneous claims cannot both receive a token. Pending attempts remain pollable. Unknown, expired and consumed secrets all return `expired`.

Attempts expire after ten minutes; completed results after two minutes. The underlying OAuth state/cookie also has Better Auth's own expiry. Expired rows are removed on subsequent starts/claims. All handoff responses are `no-store`, with `Referrer-Policy: no-referrer`.

The old `/social/finish` URL is deliberately inert: it reports failure and neither reads a browser session nor writes a handoff. Old KV handoffs are no longer redeemable. An in-flight login during rollout may need restarting; existing authenticated sessions are not revoked.

## Rollout

Apply **directory migration `0006_social_handoffs.sql` before deploying the Worker**, and include regenerated Prisma clients/embedded migrations. See [release preparation](releasing.md). The app's `{ url, ticket }` start response and claim response shapes remain compatible; the app follows the supplied URL rather than constructing it.

No deployment or remote migration is performed by this implementation.

## Verification and remaining acceptance

`apps/api/src/social-handoff.test.ts` exercises real Better Auth state cookies, session creation, hooks and directory transactions. Only provider token exchange/profile responses are fixtures. It covers a logged-in browser visiting direct completion with unknown/known tickets, valid OAuth and replay, missing/cross-browser cookies, client context injection, expired attempts/results, provider refusal, invalid codes, repeated starts and concurrent claims.

Before release, validate Google and Microsoft consent, cancellation, account selection/link refusal, slow/expired attempts, browser return and native polling on the actual deployed origins and supported installers. Automated fixtures do not establish live-provider or signed-installer acceptance. Keep the regression suite mandatory when upgrading Better Auth: callback hook paths and server-owned OAuth context are security boundaries.

This does not protect a user who deliberately completes an OAuth flow opened from an untrusted person's login link. Users should start login from their own app. Rate limiting/abuse monitoring for unauthenticated attempt creation remains operational follow-up; do not mistake ticket entropy for abuse prevention.
