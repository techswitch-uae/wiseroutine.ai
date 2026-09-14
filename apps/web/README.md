# Wise Routine launch site

TanStack Start + React, server-rendered by Nitro. A separate marketing app,
not an authenticated web version of the desktop app.

```sh
pnpm install --frozen-lockfile
pnpm web                         # http://localhost:42000
pnpm --filter @wiseroutine/web test
pnpm --filter @wiseroutine/web typecheck
pnpm test:web-browser            # builds and boots its own production server
```

## What visitors see

- The promise: activities fit around meetings and adapt when plans change.
- An interactive sample: placement → longer meeting → affected block moves,
  walk stays put → full day → visible unplaced work → restore.
- The approved free boundary: **3 active activities**, automatic placement and
  basic adaptation. No card, trial, checkout or speculative discount.
- Read-only calendar and meeting-detail privacy explanations.
- A sample-first introduction, a quiet account link beside it, and one closing
  signup invitation. No repeated “Start free” prompts.
- Installer availability stays in preview until validated builds are supplied;
  that does not turn off account signup.

`src/components/sample-day.tsx` uses the same `DayGrid`, `Slot`, buttons, logo,
fonts and tokens as the desktop. `src/lib/sample-day.ts` calls the shared
`plan()` and `rearrange()` engine with fixed synthetic UTC data. It never
connects to a calendar, saves a routine or demonstrates provider sync speed.
The initial plan and all copy render without JavaScript; controls enable only
after hydration. No analytics, remote fonts or third-party embeds.

## Demonstrate the value, then invite signup

The hero leads with **Try a sample day**. “No signup needed” explicitly applies
only to that sample, not to using the app. Keep the copy concise and neutral:
show scheduling behavior, explain what’s included, and offer a clear next step.
The inclusion section explains Free without adding another signup button.

Account links use `signupUrl` in **`src/content/release.json`**. The initial
value, `https://app.wiseroutine.ai/signin`, follows the production `APP_URL` in
`apps/api/wrangler.jsonc`. **Confirm/deploy that host before publishing**; a
configured origin is not evidence of a live signup deployment.

The existing `apps/desktop/src/routes/signin.tsx` handles both new accounts and
returning users. It sends the emailed code through the existing Better Auth API,
then verifies it to create/sign in to the same Free account. No second mailing
list, duplicate account system, automatic trial or paid enrollment is added.
The sample lets visitors evaluate the product before creating an account; it is
not counted as account activation. Signup does not by itself establish consent
to unrelated marketing emails or discount eligibility.

The web E2E suite tests each account link's navigation to that destination,
intercepting the destination **without pretending to complete registration**.
Actual email delivery, verification and account creation still require the app's
signup acceptance against the intended deployment.

## Turn on launch downloads

Edit **`src/content/release.json`** only after the platform/provider/native
acceptance in [launch](../../docs/launch.md) and
[releasing](../../docs/releasing.md) is complete:

- Set `status` to `live`.
- Add one entry per validated build to `downloads`: `platform` (including
  architecture), `requirements` (minimum OS / applicable limitations), and a
  public HTTPS `url`.
- Re-run unit and browser suites. The browser availability test automatically
  checks every configured link and its requirements.

Preview deliberately has no installer links or pretend mailing-list form;
it still invites visitors to create a free account. Validation rejects invalid
signup destinations, live-without-downloads, preview-with-downloads, missing
requirements, duplicate platforms and unsafe URLs. It cannot verify signing,
notarization, availability at the remote URL or actual provider support: smoke
test those separately. No OS sniffing; visitors can see every supported build.

Before a public launch, publish approved privacy/terms/support destinations and
link them as appropriate. The FAQ is an explanation, **not a legal policy**.
Founding discounts remain absent until their terms and eligibility are approved.

## Build and deploy

```sh
# Tests and shared dependencies gate the build; no desktop or API build needed.
pnpm exec turbo run build --filter=@wiseroutine/web...
PORT=42000 HOST=127.0.0.1 pnpm --filter @wiseroutine/web start
```

Deploy **all of `apps/web/.output`** to a Node host using the repo's Node version.
Start with `node .output/server/index.mjs`, set `PORT` / `HOST` for that host,
and terminate HTTPS at the hosting layer. This is the `node-server` Nitro
preset, not a Cloudflare Worker or static-only deployment. No production
credentials or infrastructure changes are included.

Canonical, sitemap and social URLs use the approved **https://wiseroutine.ai**.
Keep preview deployment URLs non-indexable at the hosting layer. Check `/`,
`/robots.txt`, `/sitemap.xml`, `/social-card.png`, and a real 404 after deploying.

## Product imagery

The main visual is live shared app UI, so it doesn't go stale as a screenshot
would. `public/social-card.png` is a 1200×630 capture of that same hero.
Regenerate it after copy/design/availability changes:

```sh
# With pnpm web running in another terminal:
pnpm --filter @wiseroutine/web social-card
# Or supply a local production preview URL:
pnpm --filter @wiseroutine/web social-card http://127.0.0.1:42000
```

The generated route tree is committed, matching the desktop convention, so a
fresh checkout can typecheck before running Vite.

Browser setup, coverage, screenshots and CI: [testing](../../docs/testing.md).
