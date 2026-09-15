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
| App full stack | First activity/setup, free limit and removal, edit persistence, daily availability, auto-placement and accepted-slot stability, drag/skip/undo, calendar selection, privacy opt-out, view/settings persistence | Real React app → Worker → migrated libSQL; most scenarios seed auth/consent; dedicated OTP and provider-delivery journeys exercise the real internal paths |
| App core/release | Default-off routes, hidden shortcuts/assets, core recovery, preview enable/disable; approaching → due → running → done cues in timeline/widget; delayed/refused Start, refresh/reload, stop cutoff; early Start → Stop → scheduled cutoff, stale Postpone closure, reload and Done; in-place postponement without copies; first Start after movement expires, exact end, wake and reload | Native webview, tray, OS permissions and signed installers require separate checks |
| Activity planning | Duration-aware frequency and save/reload; tomorrow-effective edits and old-bucket exclusion; repeated activities spread across Today; future-only pointer/keyboard movement; Not placed merges fresh demand and saved slots; no-space toast, reload/retry without duplicates, keyboard/pointer placement, and automatic placement preserving existing slots | Shared scheduler rules plus Worker/database integration; see [activity planning](activity-planning.md) |
| App capture | Keyboard/focus, links and multiple files, exact download bytes, offline draft recovery, plan/postpone and return to Inbox | Existing release/entitlement fixtures; not live OAuth or production storage |

The suites currently contain **44 web browser cases** (11 stories × 4
browser projects), **30 web unit cases**, and **70 full-stack app scenarios**.
Counts will change as coverage grows; the actual run/report is authoritative.

## Isolation and reproducibility

- Web owns port **42100**, builds the production server, and refuses to borrow
  an existing process. Development uses **42000**. The sample has fixed UTC
  instants and never makes provider requests. Tests use fresh browser contexts.
- App owns **41190–41194** for its directory DB, primary user DB, Worker, UI and
  secondary user DB. It starts three disposable `turso dev` servers, migrates them, resets between
  tests, and tears down their process groups. Worker state uses the separate
  `.wrangler/e2e-state` directory, not the developer's ordinary KV store.
- Existing-routine browser fixtures use the gated `/test/routine` endpoint;
  this seeds a routine established before today, rather than bypassing the new
  production rule that an added activity starts tomorrow. Creation/edit scenarios
  still drive the real form. API clock tests cover local midnight and DST;
  browser rollover tests coordinate a guarded API clock with Playwright's clock,
  including Settings and overnight offline/reconnect, without waiting for midnight.
- App scenarios stay **serial** and reset all three databases. Ordinary seeded
  accounts share the primary user DB; session-boundary scenarios explicitly seed
  a second tenant into an independent user DB. This is controlled local routing,
  not evidence for production Turso hostname routing or infrastructure isolation.
  Its normal timezone fixture keeps remaining-day planning in the morning.
- `authentication.spec.ts` drives real OTP generation/verification, expiry, HTTP
  throttling, first provisioning, failure/retry and returning sign-in. Only mail
  delivery is a guarded sink. `calendar-repair.spec.ts` supplies controlled provider
  pages; normalization, privacy storage and the worker's shared repair pipeline run.
  Scheduled test syncs use the same controlled page boundary, never live providers.
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
Desktop `typecheck` also checks browser specs and Playwright configs, so undefined
fixture variables cannot hide outside TypeScript coverage. The Release workflow
calls this same complete CI workflow with the candidate SHA before installers
build; releases stay drafts. See [the acceptance contract](release-contract.md).

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

## Native tray regression checks

```sh
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib tray::tests
```

These cover clock-only expiry and the native title-write boundary, including
an hour-old last slot and an empty schedule. The setter model matches the
pinned macOS tray library: `None` leaves existing text unchanged, while an
explicit empty string clears it. Selecting no next slot alone is not enough.

For native acceptance, rebuild/restart the desktop binary and hide its window
with one pending slot. After two minutes from its start, **Start now** must
remain available while time remains (movement in the app must be closed).
Let the slot **end**. After the next native tick (at most 15 seconds), only the
tray icon should remain; the menu should say **Nothing up next**, with
**Start now** disabled. Repeat after completing the last slot and signing out. Rust unit tests
model the setter contract; they do not drive a live AppKit status item.

## Rules migration regression checks

- Scheduler: shared candidate scoring for initial placement and repair,
  breathing-room preference versus hard occupancy/spacing, exact movement and
  first-Start boundaries (`rules-contract.test.ts`).
- API: real background sweeps at the movement cutoff, after the old three-minute
  grace, at slot end and after overnight sleep. No automatic manual-slot moves
  or guessed outcomes; valid recorded offline Starts survive.
- API: reading future days creates no slots/events/plan runs; all accepted
  legacy `/plan` trigger labels use the same preserve-existing placement path.
- API: calendar repair honors the cutoff for both manual and automatic slots;
  started slots cannot be moved or bucketed by a stale repair decision.
- Browser: `late-start.spec.ts` uses a guarded fixture for a previously accepted
  appointment. Both timeline and widget submit a real late Start, preserving
  identity and scheduled bounds through reload. Browser-clock expiry tests
  verify exact UI boundaries; API tests independently enforce server time.
- Browser: tomorrow-effective edits and day navigation are tested with weekly
  planning enabled, without creating a routine just by viewing it.

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
