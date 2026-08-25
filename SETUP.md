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
one back out — not the dashboard, not us — so rotating means writing a new
value there, and the next isolate has it without a deploy. `pnpm deploy:*`
refuses to ship if a declared secret is absent, and refuses to finish if the
deployed Worker cannot validate what it resolved. Local development is the one
exception: `apps/api/.dev.vars`, gitignored, never a real credential.

The rest of this file is the vendors — the accounts those secrets come from,
roughly in the order they block something.

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

Google is now only used to *connect a calendar*, never to sign in, so this no
longer blocks anyone from having an account. Still start the verification clock
as soon as the OAuth flow works — it remains the longest lead time here.

1. Create a project, enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client ID** (Web application) — one for dev, one for
   production, so a test consent screen never touches real users. Redirect URIs:
   `https://api.wiseroutine.ai/connect/google/callback`,
   `https://api-dev.wiseroutine.ai/connect/google/callback`, and
   `http://localhost:8787/connect/google/callback` for local work.
3. On the consent screen add exactly these scopes — no more, since over-broad
   scopes are the top rejection reason, and no fewer, since adding one later
   triggers re-verification:
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
2. Redirect URIs: `https://api.wiseroutine.ai/connect/microsoft/callback`,
   `https://api-dev.wiseroutine.ai/connect/microsoft/callback`, and
   `http://localhost:8787/connect/microsoft/callback`.
3. Delegated permissions: `openid`, `email`, `profile`, `offline_access`,
   `User.Read`, `Calendars.ReadBasic`.
   `offline_access` is what produces a refresh token — omitting it is the most
   common oversight here.
4. Create a client secret, then:
   The client *ID* is a var; the secret goes in the store, one per
   environment. See [docs/setup-api.md](docs/setup-api.md).

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
