# Wise Routine — project audit

## Executive assessment

The project has a strong core, but several integration paths undermine its promises. The biggest opportunities are **reliability and trust before additional features**: keeping the schedule current, preserving offline actions, enforcing privacy consistently, and producing a correctly configured release.

Keep the deterministic scheduler, shared plan-capability definitions, tenant-specific repositories, sandboxed addons, and distinctive visual identity. A rewrite is not warranted. Concentrate on the boundaries between those pieces.

### Original audit scope and evidence

Reviewed the desktop React/Tauri app, Worker API, scheduler, storage/repositories, calendar synchronization, authentication, billing, addon boundary, design system, and build/release configuration.

Checks performed:

| Check | Result |
| --- | --- |
| Fresh workspace typechecks and tests, bypassing Turbo cache | Passed: **1,354 tests** |
| Native Rust tests, locked/offline | Passed: **19 tests** |
| Workspace web build | Passed; build/cache configuration warnings noted below |
| Lint | Failed: **2 errors, 1 warning** |
| Playwright suite | Blocked by CORS configuration; repeated failures, then stopped by the command timeout before all 28 scenarios completed |
| Production dependency audit | **4 high and 4 moderate advisories**; dependency reachability needs triage |
| Browser UI inspection | Day, Settings, and Activities rendered with synthetic API responses at 1180×820 and 800×650 |
| Settings interaction reproduction | Confirmed that an unrelated toggle sends unsaved working-hour changes |

The browser UI inspection is not evidence that real OAuth, calendar-provider integration, or packaged native behavior works. No production load tests, live-account security exploitation, or signed installer tests were performed. An optional sign-in diagnostic failed and was abandoned; the associated finding below is based on source inspection only.

The initial audit did not change application source. A subsequent implementation pass addressed the decision-independent P1 work. Current verification and remaining release requirements are recorded below; only fully addressed findings have moved to **Done** at the end.

### Implementation verification

- Fresh, uncached workspace typechecks and **1,413 tests** pass.
- **20 native Rust tests** and **9 release-configuration tests** pass.
- A clean build, after removing generated addon and desktop output directories, includes all six addon bundles/manifests. Its public JavaScript contains the configured production API URL and no `http://localhost:8787` fallback.
- The browser harness now supplies its actual app/API origins. **2 dedicated browser regressions pass**, covering opening/refreshing operational today on Settings and persistent privacy opt-out.
- The full browser suite is **not green**: a bounded run reached 6 passes and 3 failures before stopping. The failures concern a disabled-state assertion against a non-button chip and two scenarios expecting automatic placement for a free account. Those existing assertions/policies need separate review; they have not been weakened to make the run pass.
- Lint still reports the original **2 errors and 1 warning**. Live Stripe/provider integrations, production tenant routing/load, suspended-webview behavior, and signed installers/updates remain unverified.

Deployment and local-data compatibility requirements are in [`releasing.md`](./releasing.md), including directory migrations, signing configuration, account-scoped native addon secrets, and recovery of legacy unscoped offline actions.

### Priority meanings

- **P0:** review and resolve before exposing the affected authentication path.
- **P1:** fix before wider production rollout; correctness, privacy, data integrity, or release reliability.
- **P2:** near-term usability, accessibility, maintainability, and efficiency.

## Open findings

The descriptions preserve the original audit evidence. Status notes distinguish completed sub-work from what remains open.

### 1. P0 — Social sign-in completion can publish a session under an unverified ticket

**Evidence:** `apps/api/src/routes/signin.ts:173–249`.

`/social/go` checks that a ticket was issued and is pending. `/social/finish` does not perform the equivalent check: it accepts any nonempty `ticket`, resolves the current browser session, and writes that session token under the supplied ticket. The unauthenticated `/social/claim` endpoint then returns the parked token.

This appears to create a session-exfiltration path when a signed-in browser is navigated to the completion endpoint with a ticket known to another party. The completion handler does not itself establish that this navigation followed the matching, successfully verified OAuth callback.

**Confidence:** high-confidence code-review concern, **not an end-to-end verified exploit**. Cookie behavior and the exact deployed auth flow still need controlled security validation.

**Recommendation:** bind handoff completion to the verified OAuth attempt and initiating browser, reject unknown/expired/consumed tickets, and require a one-time flow-bound completion proof. Merely checking that a ticket exists is insufficient if another party can mint a ticket and induce completion in a different browser. Use an atomic consume operation for redemption rather than KV read-then-delete, which does not guarantee single use under concurrency/eventual consistency.

**Regression tests:** direct completion without OAuth, unknown tickets, cross-browser tickets, expired tickets, and simultaneous claims.

### 3. P1 — The release path is not ready to produce a dependable installer

**Status: partially addressed; remains open.** Added the Node version file, fail-closed production configuration checks, public-key overlay, workspace/native release verification, package-local addon outputs, explicit desktop dependencies/assembly, and cache invalidation for API URLs/build scripts. A clean frontend build and release-config regression tests pass. **Still required:** select/provision the intended release environment and signing credentials, then validate actual signed installers and updates. No credentials were invented, and installer readiness is not claimed.

**Original finding:**

**Evidence:** `.github/workflows/release.yml:85`; `apps/desktop/src-tauri/tauri.conf.json`; `apps/desktop/src/lib/api.ts:22`; `apps/desktop/package.json`; `turbo.json`; `addons/*/vite.config.ts`.

Several independent problems need closing:

- The release workflow references `.node-version`, which is absent.
- The API client falls back to `http://localhost:8787`. The build inspected during this audit contains that URL, and the release workflow does not set `VITE_API_URL`.
- The updater public key is empty. Release automation is intentionally manual, but signed updates are not ready as checked in.
- Tauri's `beforeBuildCommand` runs the desktop package's `pnpm build`, which is Vite directly, not the root Turbo task graph. That path does not gate on tests or explicitly build addon bundles.
- Addons write build artifacts into `apps/desktop/public/addons`, outside their own package's declared Turbo outputs. The build emitted missing-output warnings.
- The desktop package does not declare build dependencies on the individual bundled addon packages. Root build ordering therefore does not explicitly guarantee those assets exist before the desktop public directory is copied.

**Recommendation:** one explicit release build target that validates production configuration, runs checks, builds addons in dependency order, builds the frontend, and then packages/signs it. Give each addon cacheable package-local outputs and assemble them explicitly. Test from a fresh checkout without pre-existing generated assets.

### 7. P1 — “Today's plan” is still owned by the Day page, despite shell-level consumers

**Status: decision-independent work addressed; remains open for native freshness policy.** `lib/today-controller.ts` now belongs to the signed-in shell and owns full-day loading, invalidation, foreground/online recovery, aligned-minute refresh/rollover, and operational starts. Native tray handling moved out of Day; page callbacks unregister, viewed state clears on unmount, and the session overlay reads operational today. Regression tests cover route-independent startup, stale-load ordering, midnight clearing, teardown, and Settings-page refresh. **Still required:** decide and validate what must remain fresh when the native webview is suspended. Timer-based webview behavior is not presented as a native background-service guarantee.

**Original finding:**

**Evidence:** `apps/desktop/src/lib/plan-store.ts`; `apps/desktop/src/routes/_app.index.tsx`; `apps/desktop/src/routes/_app.tsx`; `apps/desktop/src/modules/session.tsx`.

The shell reads today's plan for notifications and the tray, but only the Day page fetches and publishes it. Starting on Settings/Week does not establish that plan. Navigating away retains a snapshot without a route-independent freshness mechanism. Midnight detection and the tray-start event listener also live on the Day page.

`publishStart`, `publishMove`, and `publishReload` register page callbacks without unregistering them. Shell-level actions can subsequently invoke callbacks belonging to an unmounted page.

**Recommendation:** a session-scoped plan controller that owns fetching, mutations, invalidation, midnight rollover, online recovery, and native events. Views subscribe to it. Separate today's operational plan from the date/range currently being browsed. For a hidden native window, decide explicitly which freshness responsibilities must live outside a suspended webview.

### 12. P2 — Offline date/range handling can show the wrong plan

**Evidence:** `apps/desktop/src/lib/offline.ts:68–85`; `apps/desktop/src/lib/api.ts`, `today`.

The cache decides whether a plan is “today” using its visible range bounds. A working-hours plan becomes unavailable at the end of that visible range, even though it is still the same local day. Conversely, the fallback does not verify that the saved plan matches the requested future date or range: a failed future-day request can return today's cached plan.

**Recommendation:** key caches by account, local date, and relevant range/version. Separate date validity from viewport bounds. Never silently substitute a different date; offer an explicit return to saved today.

### 13. P2 — Day navigation has timezone and stale-response bugs

**Evidence:** `apps/desktop/src/routes/_app.index.tsx:56–67,118–146,323–326`; `apps/desktop/src/lib/scope.ts:128`.

The day page uses device-local noon as a proxy for an account-local date. The comment claiming real timezone pairs cannot differ by more than 12 hours is incorrect. Device-local `todayOf()` also disagrees with account-local today around midnight.

Within the same session, Day fetches still have no date/range-key guard, so a slow previous-date or previous-range response can overwrite a newer choice. Session-change cancellation is now implemented, but does not solve this separate race. The minute rollover condition reloads whenever the viewed data is not today—even when the user intentionally browsed a future date.

**Recommendation:** exchange explicit local-date strings interpreted in the account timezone; guard every response against the current request key; only perform automatic today rollover when the view follows today.

### 14. P2 — Settings commit boundaries do not match what the UI promises

**Evidence:** `apps/desktop/src/routes/_app.settings.tsx:247–324`; `packages/design/src/screens.tsx`, `DayHoursSection`.

**Reproduced in the browser:** change working hours from 08:00 to 07:00 without pressing Update, then toggle “Show meetings outside the range.” The outgoing PATCH includes `dayStartMinutes: 420`, committing the unsaved edit.

Each block has its own Update/Cancel affordance, but `commit()` and `save()` send the entire draft, and cancel resets the whole draft. Optimistic writes can also finish or roll back out of order.

**Recommendation:** independent block drafts and block-specific patches, or one clearly labeled whole-page Save/Cancel model. Serialize or version optimistic mutations so an older failure cannot revert a newer successful choice.

### 15. P2 — Narrow-window layout wastes space and becomes difficult to read

**Evidence:** `apps/desktop/src/routes/_app.tsx`, `reserveRail={!fullWidth}`; `packages/design/src/layout.tsx`, `AppFrame`; `packages/design/src/app.css`, sidebar/rail layout.

**Reproduced at 800×650:** Activities reserves an empty right rail. The sidebar measures 200px, the reserved rail about 290px, and the main column only about 302px before its inner padding. Names and metadata wrap into extremely narrow columns while a large area on the right remains empty.

At the default 1180px width, the day header also wraps its date and time span awkwardly under the competing controls.

**Recommendation:** do not reserve an empty rail on non-calendar pages at small widths. Collapse the detail rail below a tested breakpoint, provide a drawer/inspector toggle, and let row actions move to a secondary line or menu. Define a minimum supported native size as a fallback, not a substitute for responsive layout. Check 200% zoom as well as screen width.

### 16. P2 — Modal accessibility is incomplete

**Evidence:** `packages/design/src/components.tsx:2160–2221`; `apps/desktop/src/modules/quick-add.tsx:329–406`.

The shared modal announces `aria-modal`, but does not trap focus, make the background inert, move focus intentionally on open, or restore the opener on close. Quick Add focuses itself, but in its “when” step intercepts Tab to change duration rather than follow normal focus navigation.

**Recommendation:** a shared, tested accessible dialog primitive, preferably using native dialog behavior or a mature headless implementation. Preserve normal Tab/Shift+Tab navigation and offer a different shortcut for cycling duration. Add keyboard-only and screen-reader checks; ARIA labels alone do not establish accessibility.

### 17. P2 — Error states sometimes look like empty schedules or successful actions

**Evidence:** `apps/desktop/src/routes/_app.week.tsx:60–80`; `_app.month.tsx`; `_app.index.tsx`, `load` and `refresh`; `modules/setup-rail.tsx:226–235`; `routes/signin.tsx:117–119`.

- Week/month fetch failures become empty data without a clear unavailable state. An empty schedule should not imply free time when the server could not be reached.
- Sync failures are swallowed, while the spinner stops on a fixed timer rather than confirmed completion.
- The onboarding modal ignores the error string returned by `beginConnect()` and closes as though the handoff succeeded.
- Sign-in tells users “The server log says why,” which is not an actionable recovery path for them.

**Recommendation:** distinguish loading, empty, stale, unavailable, and authentication-expired states. Keep last-known data visibly marked stale where appropriate. Offer Retry/Reconnect and human-readable recovery instructions. Track sync completion rather than guessing with 1.2/4/10-second timers.

### 18. P2 — The browser test harness and CI do not currently protect integration behavior

**Status: partially addressed.** The test Worker now receives explicit app/API origins, and real browser requests pass CORS. New critical-path regressions were added. The broader suite exposed existing assertion/policy mismatches described in the verification summary, and automatic PR CI is still absent. Release verification is not a substitute for a PR gate.

**Original finding:**

**Evidence:** `apps/desktop/playwright.config.ts`; `apps/api/src/auth.ts:267–286`; `.github/workflows/release.yml`; `biome.json`.

The browser suite runs on port 41193, but the API trusts configured `APP_URL` (41000 locally) and development port 41100. Its Worker command overrides database URLs but not `APP_URL`. A direct preflight check confirmed the response omits `Access-Control-Allow-Origin` for the test origin.

The only GitHub workflow present is a manually triggered release workflow; there is no automatic PR quality gate. Lint currently fails on mixed component/non-component exports and a hook dependency rule, with one optional-chain warning.

**Recommendation:** pass the test app URL explicitly to the test Worker; add a startup assertion for CORS and authenticated API access; then rerun the entire suite. Add PR checks for lint, types, unit tests, native tests, and a small critical-path browser suite. Review hook lint suggestions rather than applying them blindly when a dependency is an intentional reset trigger.

### 19. P2 — Synchronization and scheduled work will do unnecessary serial work at scale

**Evidence:** `packages/db/src/user/events.ts`, `upsertEvents`; `packages/db/src/directory/schedule.ts`, `dueWork`; `apps/api/src/index.ts`, cron and queue handlers; `apps/api/src/sync/engine.ts`.

- Event ingestion reads all stored tags for a calendar, then performs changed-event upserts one remote call at a time.
- Cron fetches due rows and then looks up their users individually, serially, up to 200 rows per tick.
- Due work is read rather than atomically leased before queueing. Slow jobs can be enqueued again by a later tick; foreground and webhook nudges add further duplicate opportunities. Completion revisions now protect newly scheduled work, but do not provide leasing/deduplication.
- OAuth refresh happens before the sync loop's `ProviderError.needsReauth` catch, so refresh-token rejection does not consistently follow the same reconnect-state path as event-fetch rejection.
- The 40-page safety cap can exit without proving pagination completed, yet still records a successful incremental sync. Large calendars need an explicit incomplete/retry outcome.

**Recommendation:** batch reads/writes, bounded concurrency, leased/claimed work with completion versions, per-connection token-refresh coordination, and explicit sync failure categories. Only advance sync checkpoints after a complete successful page sequence. Measure these before adding caches: remote round trips are the more obvious bottleneck than React bundle size.

### 20. P2 — Pausing, history, and scheduling semantics need a consistent product rule

**Follow-up evidence:** existing browser scenarios expect automatic placement for free accounts, while current capability rules expose automatic planning as Pro. The implementation pass preserved those capability rules rather than changing the product to satisfy the tests. Resolve the intended behavior and update the corresponding scenarios explicitly.

**Evidence:** `packages/db/src/user/activities.ts`, `setActivityActive`; `apps/api/src/routes/app.ts`, `fillDay` and `POST /plan`; `packages/db/src/user/slots.ts`, `listSlotsForRange`; `apps/api/src/planning/planDay.ts`.

- Pausing an activity changes its flag but does not remove its already-planned future slots, unlike archive/addon-disable paths.
- First opening/planning a day can place sessions in hours already past. That presents hypothetical intentions as though they were a plan the user could actually have followed.
- Slot range queries select by start time only, omitting slots that began before the visible range but overlap it.
- Planning treats all non-planned statuses as locked occupied time, including canceled/bucketed records. Some of those should no longer reserve time.

**Recommendation:** write a short state-transition and occupancy specification. Make “paused,” “missed,” “skipped,” “canceled,” “bucketed,” and “completed” mean the same thing to the solver, API, timeline, and progress widgets. Plan the remaining day by default; label any retrospective/hypothetical view explicitly. Query overlapping intervals, not just start timestamps.

## Architecture recommendations

### Keep the monorepo, but sharpen boundaries

The package split is sensible. The largest risk is not the number of packages; it is responsibilities crossing boundaries without a single owner.

A useful direction:

```text
Desktop
  session lifecycle
    ├── account-scoped query/cache state
    ├── today's operational plan controller
    ├── addon lifecycle
    └── native schedule bridge
  routes → render data and issue commands

Worker
  routes → validate/authenticate → application services → repositories
                                      ├── pure scheduler
                                      └── durable follow-up work
```

1. Extract application services for planning, slot lifecycle, calendar selection, and addon lifecycle. `apps/api/src/routes/app.ts` is roughly 2,078 lines and currently mixes HTTP concerns, authorization, orchestration, validation, and response shaping.
2. Introduce shared runtime request/response schemas. The 1,153-line desktop API module manually mirrors many server types, and TypeScript assertions do not validate JSON.
3. Keep `useSyncExternalStore` for small UI state. Consider TanStack Query or an equivalent explicit query cache for server state, but do not introduce a library without fixing state ownership first.
4. Keep user-database isolation if it is a deliberate privacy/product choice. Budget for migration rollout, backups/restores, deletion/export, tenant-routing tests, and directory reconciliation. The test setup deliberately maps users to one local user database, so it does not demonstrate production tenant isolation.
5. Reduce duplicated historical commentary in implementation files. Preserve invariants and rationale, but move long change narratives to ADRs or tests. Several comments currently describe behavior the code no longer implements.

## Performance recommendations

### Highest return

- Batch remote database operations and make plan replacement atomic.
- Deduplicate account/calendar/activity queries shared by the shell, setup rail, and pages.
- Eliminate unnecessary requests while browsing a future date.
- Avoid synchronous provider calendar discovery as part of a user-facing refresh acknowledgement.
- Return one useful bootstrap snapshot where it reduces a demonstrable request waterfall; do not create a giant endpoint that couples every feature.
- Request deadlines, session cancellation, and immediate local sign-out are now implemented. Measure remaining startup/request waterfalls rather than adding more state layers speculatively.

### What the build actually shows

The main browser entry was about **299 kB uncompressed / 96 kB gzip**, and shared CSS about **84 kB / 20 kB gzip**. Those numbers do not justify a frontend rewrite. Route splitting already exists. Do not confuse the generated Nitro server bundle with bytes downloaded by the desktop client.

For a desktop SPA, reassess whether TanStack Start plus Nitro SSR/prerender infrastructure is earning its complexity over Vite plus TanStack Router. This is an optional simplification, not an urgent migration.

Keep `/design`, `/design-sessions`, and `/sim` in development-only routing/builds if they are not intended customer surfaces. They are currently present in the production route/build output, though split into separate chunks.

### Measure next

Define budgets and capture p50/p95 for authenticated `/today`, initial sync, plan persistence, and startup-to-usable UI. Track database round trips per operation, queue lag, retries, incomplete syncs, and migration failures. Cloudflare logging is already enabled; add structured operation/user-safe correlation IDs and actionable alerts without logging calendar text or tokens.

## User experience and design recommendations

### Preserve the identity

The warm neutral palette, distinct display font, recessed meeting blocks, and raised activity surfaces give the app character. Keep them. The most valuable design changes are hierarchy, adaptability, and state clarity—not a new visual theme.

### Improve the first useful session

- Let users try one activity before requiring two, a calendar connection, and notification permission.
- Offer a short sample day or lightweight preview while calendar consent/sync is pending.
- Treat notification permission as optional and recoverable, not an onboarding step that can remain permanently incomplete after denial.
- Put confirmation of working hours on the setup surface itself, or mark it complete after actual confirmation rather than merely navigating to Settings.
- Show exactly what connecting a calendar means: which accounts/calendars are read, whether titles/descriptions are stored, and the fact that nothing is written back.

### Make the calendar explain itself

- Distinguish “nothing planned,” “everything done,” “no space left,” “calendar disconnected,” and “could not load.”
- Surface why an activity moved and offer an Undo/keep-here action when appropriate.
- Make unplaced work and time conflicts visible without forcing users to infer meaning from orange styling alone.
- Use shorter responsive day headings, keep the date dominant, and move secondary metadata out of constrained header space.
- Keep density controls; test the default scale with realistic busy days rather than only short examples.

### Close incomplete account flows

Settings now exposes the meeting-details privacy preference. Data export/delete-account controls and a billing management surface remain absent. Billing endpoints return to `/billing/complete`, but that route is absent from this app's route tree. If another application owns it, document and test that contract; otherwise implement it before enabling checkout.

The Microsoft sign-in error tells users to link Microsoft from Settings, but Settings currently only lists/disconnects existing sign-in methods. Either provide the promised link flow or change the recovery copy.

Add a searchable timezone picker with current local time/UTC offset and an explicit “follow device timezone” choice. Distinguish a deliberate account timezone from one inferred at sign-in.

### Accessibility and visual clarity

- Test keyboard operation, 200% zoom, reduced motion, and screen-reader announcements.
- Audit muted text and small metadata contrast with an automated tool plus manual review; no formal contrast pass was completed here.
- Increase small secondary labels where necessary, preserve visible focus, and give status meaning through text/icons as well as color.
- Use platform-aware shortcut labels: the implementation accepts Ctrl+K, but the UI consistently advertises ⌘K even for Windows.

## Security and dependency hygiene

The sandbox boundary is a strength: opaque-origin frames, restricted capabilities, bundle checks, and tests addressing access to the parent session token. Keep those invariants explicit.

Further hardening:

- Move the native app's long-lived session token out of JavaScript localStorage where practical. For web usage, evaluate secure HttpOnly cookies with appropriate CSRF protection.
- Addon secrets are plaintext JSON on disk with Unix owner permissions applied after writing (`apps/desktop/src-tauri/src/addons.rs:249–305`). Prefer OS credential storage and atomic writes; define equivalent Windows protection.
- Triage the **8 dependency advisories** rather than assuming all are exploitable. Reported packages include Hono, deepmerge-ts, mysql2, sharp, and js-yaml. Several arrive through unused adapters or build tooling despite appearing in the production dependency graph. Update direct Hono and relevant dependency chains, and document non-reachable cases.
- Add automated dependency updates and repeat the audit in CI.

## Suggested delivery order

This is the original delivery outline; completed P1 items are tracked in Done below, not reopened by their appearance here.

### Phase 1 — Protect trust and establish a reliable gate

1. Review/fix social handoff completion and add adversarial flow tests.
2. Correct privacy erasure and response redaction.
3. Validate scheduler inputs and bound solver work.
4. Repair offline replay and webhook idempotency/state updates.
5. Fix the E2E origin and enable PR checks.
6. Make a clean production build use the intended API, include all addons, and validate signing/update configuration.

### Phase 2 — Make the schedule dependable

1. Move today's operational state and native commands out of route ownership.
2. Add complete session teardown and account-scoped storage.
3. Centralize planning plus follow-up scheduling.
4. Replace blind grace moves with the shared gap/repair rules.
5. Add transactional writes, safe migrations, and work leasing/reconciliation.
6. Fix date/range caching, timezone handling, stale responses, and pause/occupancy rules.

### Phase 3 — Improve daily usability and efficiency

1. Fix Settings commit boundaries and narrow-window layout.
2. Complete accessible dialogs and keyboard behavior.
3. Improve loading, sync, reconnect, and empty states.
4. Simplify onboarding and complete privacy/account/billing flows.
5. Batch hot-path database work and set measurable latency/error budgets.

**Bottom line:** the core is worth keeping. The next milestone should be a routine users can trust across navigation, offline use, calendar changes, account changes, and updates—not a larger feature list.

## Done

Only addressed and regression-verified findings are listed here. Release readiness (#3), suspended-native freshness (#7), and the remaining P0/P2 work stay open.

### 2. P1 — Privacy mode leaves sensitive meeting data behind

**Resolved:** opt-out erases titles, descriptions, and join URLs together. A transaction-protected local privacy fence prevents stale sync settings from restoring them; reads also redact. Preference writers are coordinated so opt-in cannot reopen the fence after a newer opt-out, and failed cross-database writes remain conservative. Desktop snapshots/caches are purged or redacted, and Settings exposes an independent privacy control.

**Implementation:** `packages/db/src/user/events.ts`; `apps/api/src/routes/app.ts`; `apps/desktop/src/lib/privacy.ts`; `modules/privacy-settings.tsx`.

**Verified by:** API erasure, unchanged-event/day-response, stale-sync, and injected preference-write failure tests; desktop cache/response redaction tests; UI success/failure tests; browser opt-out/reload regression.

### 4. P1 — Automatic morning planning does not schedule the worker that enforces it

**Resolved:** `planAndSchedule` and manual placement write durable grace work before creating slots. Failure to write the directory marker prevents placement; failure after the marker leaves harmless reconcilable work. Scheduled-work revisions prevent an older consumer completion/failure from overwriting a new wake-up.

**Implementation:** `apps/api/src/planning/commands.ts`; `routes/app.ts`; `packages/db/src/directory/schedule.ts`; queue revision handling in `apps/api/src/index.ts`.

**Verified by:** first automatic-plan wake-up regression and stale-consumer completion/failure tests against real local databases.

### 5. P1 — Grace-period rescheduling does not actually find a free gap

**Resolved:** grace recovery runs transactionally and searches real gaps within working hours, accounting for meetings, active slots, and the meeting buffer. Multiple moves see earlier moves in the same transaction. Work with no fitting gap becomes bucketed with a reason. Next wake-up considers actual upcoming starts, grace expiry, completion, and abandonment, within the existing one-minute cron granularity.

**Implementation:** `apps/api/src/index.ts`, `sweepGrace`; `packages/db/src/user/slots.ts`, `nextGraceDeadline`.

**Verified by:** overlapping-meeting/multiple-overdue-slot regression, no-space bucketing, imminent auto-start/end deadline tests, and existing grace-policy tests.

### 6. P1 — Activity validation allows pathological scheduler inputs

**Resolved:** shared strict runtime validation rejects invalid enums, durations, minima, windows, and oversized configuration before create/patch writes. The pure scheduler independently rejects invalid durations/demand and enforces bounded input and computational work.

**Implementation:** `packages/db/src/user/activity-input.ts`; `apps/api/src/routes/app.ts`; `packages/scheduler/src/demand.ts` and `plan.ts`.

**Verified by:** invalid create/patch cases with unchanged persisted activities, plus `packages/scheduler/src/bounds.test.ts` covering zero/negative/nonfinite durations, excessive demand, invalid instants, and work limits.

### 8. P1 — Signing out does not clear all user-specific state

**Resolved:** centralized session generations/cancellation reset plans, todos, account data, callbacks, addon ports/registry, selections, notifications, and native schedules. Late results cannot populate the next session. Setup flags, addon local storage, cached plans, pending actions, and native addon files/secrets are account-scoped. Local sign-out no longer waits for network revocation.

**Implementation:** `apps/desktop/src/lib/session-lifecycle.ts`; participating stores; `addons/host.ts` and `installed.ts`; `apps/desktop/src-tauri/src/addons.rs`.

**Verified by:** session reset/abort/late-response tests, cross-account queue isolation, callback/port cleanup coverage, account-qualified addon-frame tests, and the native account-namespace test. See `releasing.md` for legacy local-data compatibility; native suspended-window behavior is still tracked in #7.

### 9. P1 — Offline replay can silently discard recoverable actions

**Resolved:** drains are serialized; network/408/429/5xx failures retain actions; 401 pauses until session renewal; Retry-After/backoff is honored. Permanent rejections are visible and are not counted as sent. Unavailable/full device storage cannot produce a false “queued” acknowledgement. Online and replayed actions share an idempotency key, committed atomically with status/history. Replaying an old start cannot undo a later completion. New queues persist for the same account across reauthentication and are inaccessible to other accounts. Legacy unattributed queues are retained with a visible recovery warning, not guessed at or silently deleted.

**Implementation:** `apps/desktop/src/lib/api.ts` and `offline.ts`; `packages/db/src/user/slots.ts`; API start/complete/skip routes.

**Verified by:** lost-acknowledgement replay, overlapping drains, initial/replay rate limits, storage-quota failure, retryable status/backoff/reauthentication tests, account-change races, duplicate/conflicting keys, concurrent identical actions, and injected lifecycle failure/rollback.

### 10. P1 — Billing webhook processing can lose events and overwrite good state

**Resolved:** subscription writes, cached entitlements, and event-consumption markers commit together. Partial updates preserve omitted metadata. Webhooks reconcile authoritative Stripe subscriptions rather than trusting event snapshot order; old subscription events cannot replace a newer subscription. Canonical reads have bounded timeout/retry settings while holding the writer transaction.

**Implementation:** `packages/db/src/directory/billing.ts`; `apps/api/src/webhooks/billing.ts`; `apps/api/src/stripe.ts`.

**Verified by:** partial-update preservation, rollback/retry and duplicate delivery, canonical-state/out-of-order/old-subscription tests, and Stripe-read failure recovery. These use simulated Stripe replies with real local DB transactions; live checkout/webhook delivery remains a deployment smoke test.

### 11. P1 — Database mutations and migrations need stronger atomicity

**Resolved:** reusable writer transactions cover slot lifecycle/history, plan replacement/planning, activity-window replacement/archive, and billing. Nested scopes are tracked explicitly rather than inferred from `$transaction` presence. Migration DDL and its marker commit atomically; failures roll back. Authenticated requests and queue consumers share the required-schema gate and fail closed on upgrade failure. Cross-database planning uses the durable write-ahead/revision mechanism described in #4.

**Implementation:** `packages/db/src/client.ts`; user/directory repositories; `apps/api/src/context.ts`; `planning/planDay.ts`; new integrity/work-revision migrations.

**Verified by:** real file-backed libSQL DDL/marker failure tests, trigger-injected slot/history/plan/window rollback tests, concurrent identical action delivery, and schema-gate failure/retry tests. Local tests do not establish production tenant isolation or high-load performance.
