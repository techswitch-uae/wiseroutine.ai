# Setup

Everything here needs an account, a credential, or a decision only you can
make. The code is written and tested; these are the doors it can't open by
itself.

Infrastructure is split in two, because the two have genuinely different
lifecycles — a database migration is not a deploy:

- **[docs/setup-database.md](docs/setup-database.md)** — Turso, in local, dev
  and production.
- **[docs/setup-api.md](docs/setup-api.md)** — the Worker, its two deployed
  environments, and how secrets get in.

**One rule for secrets:** every secret lives in the account's Cloudflare
Secrets Store and nowhere else, named `WR_DEV_*` or `WR_PROD_*`. Nothing reads
one back out, so rotating means writing a new value there — the next isolate
has it without a deploy. Public values (URLs, client IDs, the From address) are
`vars` in `wrangler.jsonc` instead; that makes them editable, not optional.

Order: databases first, then the Cloudflare resources, then the vendor accounts
below — you need a Resend key before anyone can sign in, and nothing else on
this page blocks a local run.

---

## Resend — the sign-in code

Sign-in is a six-digit code emailed to the address; there is no password and no
social login. That means **email delivery is the login system** — if Resend is
down or the domain is unverified, nobody can get in.

1. Create an account and **verify a sending domain** (not just an address —
   shared domains land sign-in codes in spam).
2. Add SPF and DKIM records as Resend instructs, and a DMARC record.
3. Create an API key with send permission. `RESEND_FROM` is a var (it ships
   in every email header); the key goes in the store as `WR_DEV_RESEND_API_KEY`
   / `WR_PROD_RESEND_API_KEY`.

The free tier is 3,000 emails a month, which is roughly 3,000 sign-ins.

## Google Cloud — OAuth client, then verification

Google does two separate jobs: **signing in** and **connecting a calendar**.
One app registration serves both — the difference is the scopes each flow asks
for, so a user can sign in with Google and connect Outlook, or the reverse.

Neither blocks anyone from having an account: the emailed code always works, and
"Continue with Google" simply does not appear in an environment where these
credentials are unset. Still start the verification clock as soon as the OAuth
flow works — it remains the longest lead time here.

1. Create a project, enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client ID** (Web application) — one for dev, one for
   production, so a test consent screen never touches real users. Redirect URIs:
   **two per environment** — one for each job, and a missing one fails only
   that flow, which is a confusing way to find out:
   - sign-in: `https://api.wiseroutine.ai/auth/callback/google`,
     `https://api-dev.wiseroutine.ai/auth/callback/google`,
     `http://localhost:8787/auth/callback/google`
   - calendar: `https://api.wiseroutine.ai/connect/google/callback`,
     `https://api-dev.wiseroutine.ai/connect/google/callback`,
     `http://localhost:8787/connect/google/callback`
3. On the consent screen add exactly these scopes — no more, since over-broad
   scopes are the top rejection reason, and no fewer, since adding one later
   triggers re-verification. Sign-in asks only for the first line; connecting a
   calendar asks for all of them:
   - `openid`, `email`, `profile`
   - `.../auth/calendar.events.readonly`
   - `.../auth/calendar.calendarlist.readonly`
4. Set the secrets:
   The client *ID* is a var (it ships in every consent URL); the secret goes
   in the store. See [docs/setup-api.md](docs/setup-api.md) — you need a pair
   per environment, since dev and production are separate OAuth clients.

**For verification** you will need, before submitting:
- the domain verified in **Google Search Console**, by an account that is
  Owner/Editor on the Cloud project
- a **public homepage** that explains the app and is not behind a login (a store
  listing or a social page does not count)
- a **privacy policy** on that same domain, linked from the homepage
- a **demo video** showing the consent screen and how each scope's data is used
- a written **justification per scope**

Calendar scopes are *Sensitive*, not *Restricted* — so no CASA security
assessment and no annual re-verification. Google states review typically takes
3–5 business days; the round trips are the real cost. Until verified you are
capped at ~100 test users behind an "unverified app" warning.

## Microsoft Entra — app registration

1. Register an app. Choose **"Accounts in any organizational directory and
   personal Microsoft accounts"** and use the `/common` authority.
2. Redirect URIs — **two per environment**, sign-in and calendar:
   - sign-in: `https://api.wiseroutine.ai/auth/callback/microsoft`,
     `https://api-dev.wiseroutine.ai/auth/callback/microsoft`,
     `http://localhost:8787/auth/callback/microsoft`
   - calendar: `https://api.wiseroutine.ai/connect/microsoft/callback`,
     `https://api-dev.wiseroutine.ai/connect/microsoft/callback`,
     `http://localhost:8787/connect/microsoft/callback`
3. Delegated permissions: `openid`, `email`, `profile`, `offline_access`,
   `User.Read`, `Calendars.ReadBasic`.
   `offline_access` is what produces a refresh token — omitting it is the most
   common oversight here.
   Add `email` as an [optional claim] for managed users: Entra omits it by
   default for work accounts, and without it a sign-in has no address to key an
   account on.

   [optional claim]: https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims
4. Create a client secret, then:
   The client *ID* is a var; the secret goes in the store, one per
   environment. See [docs/setup-api.md](docs/setup-api.md).

**One asymmetry worth knowing before the first support email.** Google asserts
`email_verified` and Microsoft does not — Entra's `email` claim is tenant-mutable
and never verified by Microsoft, so trusting it would let a tenant administrator
mint a claim for an address they do not control. So a Google sign-in joins an
existing account with the same address automatically, and a Microsoft one does
not: it fails with `account_not_linked`, and the screen tells the user to sign in
with the emailed code instead. That is deliberate, and it is the safe direction
to be wrong in.

**Admin consent is handled.** Many work tenants disable user consent entirely,
so employees cannot connect without an IT admin approving the app. The callback
detects `AADSTS65001`/`AADSTS90094` and shows a screen with a copyable consent
link to forward to their administrator, rather than a dead end.

What you still need to do: **complete the app registration** (logo, terms and
privacy URLs) and consider **publisher verification** — both markedly improve
the odds an admin approves it.

## Stripe

1. Create the Pro product and a recurring price.
2. Add a webhook endpoint at `https://api.wiseroutine.ai/webhooks/stripe`
   (and one on `api-dev` in test mode)
   subscribed to: `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.payment_failed`.
3. `STRIPE_PRO_PRICE_ID` is a var; the key and the webhook secret go in the
   store. Use test-mode values for `WR_DEV_*` and live ones for `WR_PROD_*` —
   they are different Stripe environments, so this is not optional.

Local testing:
```bash
stripe listen --forward-to localhost:8787/webhooks/stripe
```

### The pro-offer kill switch

Closing the offer to new customers, without touching anyone's existing access:

```bash
pnpm wrangler kv key put --binding CONFIG PRO_OFFER_ENABLED false --env production
```

Beta users keep Pro through `plan_grants` rows, which outrank Stripe and carry a
reason and an optional expiry, so winding the beta down is per-user and audited.

## OneSignal — web only

Create an app. The app ID is a var, the API key goes in the store.

**OneSignal cannot reach the Tauri desktop app** — no Tauri SDK exists, the Web
SDK needs a service worker on a real HTTP origin, and WebView2 on Windows has no
Web Push at all. Desktop notifications go through
`@tauri-apps/plugin-notification`, scheduled locally. OneSignal covers web and
any future mobile app.

## Desktop signing (before any public build)

- Apple Developer membership → Developer ID certificate → notarisation
- Windows code-signing certificate
- A Tauri updater signing key (`pnpm dlx tauri signer generate`)

Unsigned builds get a Gatekeeper warning on macOS and a SmartScreen block on
Windows. Both certificates have lead times.
