# Browser testing

Two complementary suites. **The marketing demonstration is not evidence that
a user's live calendar, sign-in or native installer works.**

## Run locally

Use the repo's Node version and pnpm. Browser binaries are a one-time setup:

```sh
pnpm install --frozen-lockfile
pnpm --filter @wiseroutine/web exec playwright install chromium firefox webkit

# Marketing only: no credentials, API, database or running dev server needed.
pnpm test:web-browser

# Full-stack desktop-in-browser suite also needs Turso CLI and generated assets.
# See setup-database.md for local database/tool setup.
pnpm exec turbo run generate
pnpm exec turbo run build --filter='./addons/*'
node scripts/assemble-addons.mjs
pnpm test:app-browser

# Both, in sequence:
pnpm test:e2e
```

Linux runners need Playwright's `install --with-deps` variant. CI installs it.
Keep `E2E_API_URL` / `E2E_SECRET` overrides unset for local app runs; never point
the seeding/reset suite at a production API or a developer's data.

Focused commands remain available: `pnpm test:core-browser`,
`pnpm test:capture-browser`, and `pnpm test:addon-browser`.

```sh
pnpm --filter @wiseroutine/web e2e --project=chromium
pnpm --filter @wiseroutine/web e2e:ui
pnpm --filter @wiseroutine/desktop exec playwright test calendars.spec.ts
```

## What is covered

| Layer | User-perspective coverage | Boundary |
| --- | --- | --- |
| Web, production build | Value/free/availability copy, sample-first navigation, account-link handoffs to existing signup, download link configuration, meeting change → repair → unaffected walk, no-space work → recovery, FAQ, anchors, reload, 404 | Chromium, Firefox, WebKit, mobile Safari emulation; server-rendered HTML with JS off |
| Web accessibility/layout | Real keyboard navigation and skip link, native FAQ controls, axe WCAG A/AA checks in demo states, reduced motion, widths 320/390/640/800/1280 | Screenshots saved for review; automated checks are not a substitute for screen-reader or real-device acceptance |
| Web unit tests | Actual scheduler placement/repair, duration preservation, bounds/conflicts, no false confirmed placement, deterministic replay, fail-closed release configuration | No provider or app API mocks masquerading as integration coverage |
| App full stack | First activity/setup, free limit and removal, edit persistence, daily availability, auto-placement and accepted-slot stability, drag/skip/undo, calendar selection, privacy opt-out, view/settings persistence | Real React app → Worker → migrated libSQL; sign-in and provider data are seeded |
| App core/release | Default-off routes, hidden shortcuts/assets, core recovery, preview enable/disable; approaching → due → running → done cues in timeline/widget; delayed/refused Start, refresh/reload, stop cutoff and postponement/history | Native webview, tray, OS permissions and signed installers require separate checks |
| App capture | Keyboard/focus, links and multiple files, exact download bytes, offline draft recovery, plan/postpone and return to Inbox | Existing release/entitlement fixtures; not live OAuth or production storage |

The suites currently contain **44 web browser cases** (11 stories × 4
browser projects), **30 web unit cases**, and **45 full-stack app scenarios**.
Counts will change as coverage grows; the actual run/report is authoritative.

## Isolation and reproducibility

- Web owns port **42100**, builds the production server, and refuses to borrow
  an existing process. Development uses **42000**. The sample has fixed UTC
  instants and never makes provider requests. Tests use fresh browser contexts.
- App owns **41190–41193** for its directory DB, user DB, Worker and UI. It starts
  two disposable in-memory `turso dev` servers, migrates them, resets between
  tests, and tears down their process groups. Worker state uses the separate
  `.wrangler/e2e-state` directory, not the developer's ordinary KV store.
- App scenarios stay **serial**: local libSQL maps seeded accounts to the same
  user database. Do not turn on parallel workers or call this tenant-isolation
  coverage. Its timezone fixture keeps remaining-day planning in the morning.
- Web tests use semantic locators, web-first assertions and no arbitrary sleeps.
  Browser/console errors fail the interaction suite. Safari keyboard checks use
  the platform's link-navigation gesture. Buttons remain disabled until hydration.
- Account-link tests intercept the external signup destination to avoid touching
  production. They prove navigation, **not email delivery or account creation**.
  The existing app's emailed-code signup remains a live acceptance check.
- Shared scheduler unit tests cover the algorithm more broadly. The landing
  page only demonstrates a small, deliberately understandable example.

## CI and failure evidence

`.github/workflows/ci.yml` runs **all** app browser scenarios, rather than only
core/capture subsets. A separate Linux job tests the marketing production build
across all four browser projects. Focused-only tests are rejected in CI.

Both suites save HTML reports and failure traces/screenshots. Web also keeps
failure videos and 390px/1280px full-page captures. CI uploads them even on failure
with a seven-day retention period. Reports contain synthetic fixture data;
don't run these scenarios against private calendars.

```sh
pnpm --filter @wiseroutine/web exec playwright show-report
pnpm --filter @wiseroutine/desktop exec playwright show-report
pnpm --filter @wiseroutine/web exec playwright show-trace path/to/trace.zip
```

Web retries once in CI; a retry is not proof of reliability. Investigate flaky
outcomes rather than adding sleeps or relaxing assertions. App retains its
zero-retry, serial policy.

## Still manual release gates

Follow [launch acceptance](launch.md), [release preparation](releasing.md), and
[social sign-in](social-signin.md) for:

- Live signup URL/DNS, email delivery, verification → Free account creation,
  returning-account sign-in and the next onboarding step.
- Real Google/Outlook consent, reconnection and provider-change → app-repair flow.
- Native sign-in handoff, notification recovery, hidden/suspended/offline behavior.
- Signed installation, update verification and platform trust.
- Production tenant routing/isolation, deployment config and migrations.
- Real screen-reader/keyboard use at 200% zoom and on supported native platforms.
- Approved support, account/data rights, legal notices, and commercial terms.

A green sample, scheduler unit suite or seeded browser run closes none of those
live-provider/native acceptance items on its own.
