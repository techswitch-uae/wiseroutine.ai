# Feature releases: controls, implementation inventory, and acceptance

This is the implementation companion to the [launch strategy](launch-strategy.md). It is the working checklist for completing and manually accepting one milestone at a time.

**Default public experience: M0 only. Every post-launch flag defaults to `false`.** No production flags or infrastructure have been changed by this implementation. Existing installations must update both the API and desktop to obtain the new gates; older desktop builds cannot be made to hide navigation they already contain.

## 1. What the core app now exposes

- **Today · Activities · Settings.** Calendar connection/selection remains core, reachable from setup and **Settings → Manage calendars**.
- The **entire existing activity library**: **Stretch, Eye rest, Walk, Deep work, Breathing, and Water**, plus custom activities. These are ordinary timed activities, not guided sessions. The library itself is not behind a flag.
- Duration, daily count, activity days, working hours, and timezone.
- Automatic placement and calendar-change adaptation on **Free**, not an expiring trial.
- Starting, completing, skipping, dragging/changing an occurrence's time, pausing/resuming an activity, and inspecting meetings.
- Up Next, missed/unplaced work, and basic recovery. Turning off Inbox does **not** turn off routine recovery.
- Sync/reconnection, privacy controls, account settings, native notifications/tray, and updates.

Adding a new activity places its demand into the remaining day without deleting/repositioning accepted placements. Pausing cancels its still-future planned occurrences while preserving started/past history. Opening Today and explicit replanning no longer place new work in elapsed working hours.

**The existing two-active-activity limit remains.** The strategy's proposed increase to three has not been silently approved. When `larger_routines` is off, new activation/creation uses that core allowance even for a preview account with a Pro grant; existing records and subscriptions are not deleted or rewritten. Approve the final allowance before launch.

New signups no longer receive automatic 14-day Pro grants. Existing grants/subscriptions still resolve normally. Founding-user discount eligibility, pricing, and redemption are **not implemented** by these flags.

### What stays hidden with all flags off

Inbox, Quick Add and its shortcut, attachments, guided sessions/configuration, addon discovery/management, specialized addon execution, advanced activity preferences, week/month/year navigation, future-day browsing, custom day-view ranges/density controls, progress/insight widgets, dashboard customization, trial badges, and checkout availability.

The development design/simulator routes (`/design`, `/design-sessions`, `/sim`) refuse navigation in production builds independently of customer flags. There is no year route to enable.

## 2. Switch features on and off

Use the operator CLI from the repository root. It uses the existing Wrangler `CONFIG` KV binding and your Cloudflare credentials for remote environments. There is **no public administrative endpoint, browser override, or localStorage unlock**.

```sh
# Inspect the current local configuration (does not enable anything).
pnpm features show --env local

# Work on guided sessions. All existing templates are available even before this.
pnpm features enable m1 --env local
pnpm features disable m1 --env local

# Work on just text/link capture + Inbox, without file uploads.
pnpm features enable quick_capture --env local
# Or enable the entire capture milestone, including files.
pnpm features enable m2 --env local

# Return the local environment's defaults to core only.
pnpm features disable all --env local

# Give only your account a preview on the deployed dev API.
pnpm features enable m3 --env dev --user USER_ID
pnpm features show --env dev --user USER_ID
pnpm features disable m3 --env dev --user USER_ID

# Remove personal overrides and inherit that environment's defaults again.
pnpm features reset --env dev --user USER_ID

# Inspect a potential production change without writing.
pnpm features enable guided_sessions --env production --dry-run
# After acceptance, an intentional production write needs an extra confirmation.
pnpm features enable guided_sessions --env production --confirm-production
```

Available environments: **`local`**, **`dev`**, **`production`**. A missing `--env` means local. Misspelled options/environments and unknown flags are rejected. Use the account's **ID**, not email; it is `user.id` in the authenticated `/auth/get-session` response. Never copy its session token into documentation or commits.

`pnpm api` and `--env local` use `apps/api/.wrangler` state. Browser tests use a separate `.wrangler/e2e-state` store and never change your local development flags. If you run Wrangler with a custom persistence directory, adapt the CLI/run configuration to that same directory before expecting the settings to match.

### Resolution and important operating rules

- Registry/defaults: [`packages/plans/src/features.ts`](../packages/plans/src/features.ts).
- Global JSON overrides: KV key **`release-features:v1`**.
- Account JSON overrides: **`release-features:v1:user:USER_ID`**.
- Values are known flag names mapped to literal JSON booleans. Unknown keys, strings such as `"true"`, corrupt JSON, or unavailable configuration fail closed to the core-only snapshot.
- Account overrides win over global defaults, including explicit `false`. **`disable all` without `--user` changes global defaults; it does not erase personal previews.** Disable/reset relevant account overrides as well when ending a preview. There is not yet a separate instantaneous environment-wide emergency kill switch or override inventory UI.
- `enable` expands a feature's required flags. It does **not** enable all previous milestones, grant Pro, publish addon packages, configure Stripe, or finish missing features.
- `disable` leaves dependent flags' requested settings intact, but they resolve off while their prerequisites are off. Re-enabling the prerequisite can restore them. `show` prints both requested and effective values.
- `reset` deletes the selected scope's overrides. On an account, this means **inherit global settings**, not necessarily core-only. Use `disable all --user USER_ID` to explicitly keep an account on core.
- Changes reach the running app on navigation, focus/online recovery, or its **30-second refresh**. KV has its own eventual-consistency/cache delay; this is not an instantaneous security revocation guarantee. Refresh the app and inspect effective flags to confirm a rollout.
- During a transient offline error, an already verified client snapshot has a **five-minute, memory-only lease**, checked on refresh. Failed refreshes do not renew it. This lets an open capture report its offline error and retain its draft instead of disappearing immediately. Explicit server-off or malformed responses still clear access; restart/account changes start core-only. Suspended webviews do not provide an exact wall-clock hide deadline, and server authorization remains authoritative.
- Runtime flags are not build-time code removal. Disabled code may still be bundled; sensitive operations remain authenticated and server-gated.
- CLI changes are read/modify/write, not an atomic multi-operator transaction. Use a single release operator, record the change in release notes, and avoid concurrent edits. Audited administration, percentage rollout, version-targeted rollout, and operator history are future work.

### Release availability is not billing entitlement

Enabling M3 does not turn a Free account into Pro. Larger routines and advanced preference writes still use plan checks. Use an existing authorized Pro test account/grant when testing those paths. This CLI deliberately has no plan-grant command.

Do not publicly enable `billing_checkout` until the commercial flows are complete. It combines with the existing `PRO_OFFER_ENABLED` sales switch; that switch alone can no longer expose checkout. Subscription reads, webhooks, and an existing customer's portal remain available for account recovery even when new checkout is off.

## 3. Flag inventory

All initial public values below are **off**. A milestone selector enables the flags assigned to that milestone plus prerequisites; it is a convenience group, not a separate entitlement.

| Flag | Milestone | Requires | Controls |
| --- | --- | --- | --- |
| `guided_sessions` | M1 | — | Guided activity configuration, module lookup, bundled guided-session loading, overlay and automatic start behavior. Not the activity templates themselves. |
| `inbox` | M2 | — | Inbox navigation/direct route, todo list/details/status APIs, and return-to-Inbox actions. |
| `quick_capture` | M2 | `inbox` | Palette, sidebar action, ⌘/Ctrl K/custom launch event, capture API, todo placement, and bundled todo addon. Notes/links ship with this slice. |
| `capture_files` | M2 | `quick_capture` | New file inputs/drop/paste/upload/claim actions. Existing downloads and deletion remain authorized recovery paths. |
| `advanced_scheduling` | M3 | — | New/changed advanced cadence, preference anchors, importance, grace and buffer settings; current landing preference UI for Pro. Ranked alternatives remain unfinished. |
| `larger_routines` | M3 | — | Pro's higher active-activity allowance. Does not grant Pro. |
| `billing_checkout` | M3 | — | Checkout availability and commercial/trial presentation. It does not reinstate automatic signup trials. |
| `day_view_options` | M4 | — | Future-day browsing, custom range/density UI, advanced view settings and non-current-day reads. Core working hours/timezone and operational full-day reads remain. |
| `week_view` | M4 | `day_view_options` | Week route/navigation and multi-day scope reads. |
| `month_view` | M4 | `week_view` | Month route/navigation and scope reads beyond seven days. |
| `weekly_planning` | M4 | `advanced_scheduling`, `week_view` | Existing future-day planning/materialization and weekly-minimum inputs. Not a complete cross-day optimizer or finalized premium package. |
| `insights` | M5 | — | Today-so-far/progress presentation and the bundled day-so-far addon. |
| `dashboard_customization` | M5 | `insights` | Future/customizable widget availability; editor and persistence integration are still missing. |
| `community_addons` | M6 | — | Addons route/navigation, catalog/install/change/remove/bundle APIs, and non-bundled addon execution. Does not bypass M1/M2/M5 gates on first-party bundles. |

Examples of independent slices:

- `enable m1`: guided sessions, without Inbox, dashboards, or the addon-management page.
- `enable quick_capture`: Inbox + capture, without new attachments or week navigation. The single-day scope read needed to offer tomorrow's gap is allowed without exposing the week view.
- `enable week_view`: day-view options + read-only week surface, without weekly planning or advanced activity controls.
- `enable community_addons`: the ecosystem, but not automatic activation of every bundled addon. Turn on the milestone behind a bundled addon separately.

## 4. Implementation and manual acceptance, in release order

**Status vocabulary:** “Built” means code exists and is reachable behind the appropriate flag. It does not mean validated with live accounts or signed installers. Checkboxes below are intentionally open until someone performs and records the named acceptance.

### M0 — core launch (no release flag)

**Built / changed in this pass**

- Shared default-off registry, server resolution, per-account previews, operator CLI, client refresh/reset, direct-route guards, endpoint gates, and addon unload/authorization filtering.
- Simplified shell; full activity template library preserved as timed activities; advanced/session fields omitted rather than erased on basic edits.
- Free automatic planning/repair, remaining-day placement, automatic placement on activity creation, accepted-slot preservation, and Pause/Resume controls.
- No automatic signup trial, unavailable checkout blocked, no hidden-Pro upsell in core activity-limit/recovery copy.
- First-activity onboarding target reduced from two to one; notification permission no longer blocks setup completion.

**Still missing / decide before broad launch**

- [ ] Approve the active-activity allowance (currently two, proposed three).
- [ ] Resolve/revalidate the applicable [project audit](project-audit.md) findings: authentication handoff, timezone/date/cache races, settings commits, accessibility and error states.
- [ ] Complete the sample-day onboarding experience and actual confirmation of working hours; visiting Settings still marks the setup hours step as seen.
- [ ] Complete privacy/account export/deletion/support flows and recoverable notification settings where absent; these are core obligations, not paid work.
- [ ] Establish founding-user eligibility recording before publicly promising an offer; flags do not store eligibility.
- [ ] Decide native hidden/suspended/offline scheduling guarantees and validate production configuration/tenant routing/signing/updates.

**Manual acceptance**

- [ ] Fresh account, existing account with all addons installed, expired grant, and existing subscription each open with only core entry points.
- [ ] All six templates and a custom activity can be created as plain timed blocks; no guided frame/settings/download executes. Starting does not open breathing/stretch/focus guidance.
- [ ] First activity is placed, second preserves accepted slots, real meeting changes cause repair, and no-space work remains visible/actionable.
- [ ] Pause/resume/skip/move/complete work across reload, account switch, network failure and native suspend/resume. No hidden Inbox dependency.
- [ ] At 800×650 and 200% zoom, keyboard users can create an activity and complete a session.

### M1 — guided routines

Enable: `pnpm features enable m1 --env local`

**Built:** Four bundled addons (`addons/breathing`, `eye-rest`, `stretch`, `deep-work`), activity-module settings, session chrome/timers, module defaults, sandboxed frames and permissions. The installed-addon loader seeds/loads only released first-party bundles. Plain fallback remains available. The grace worker does not auto-start guided policies while M1 is off; automatic sessions already in flight can finish cleanup without auto-completing newly user-started plain sessions.

**Missing / unfinished:**

- [ ] Packaged macOS/Windows acceptance of each routine, sound, notification permissions, timer behavior and suspend/resume.
- [ ] A clear opt-in path to add guidance to activities originally created as plain blocks. Enabling M1 does not infer behavior from their names or silently convert them.
- [ ] Review template/custom-activity discoverability with guided groups enabled; the library's grouping/custom-entry behavior needs explicit acceptance.
- [ ] Guided configuration UX without requiring the M6 addon-management page; version mismatch/recovery messaging.

**Manual acceptance:**

- [ ] Each template still works without guidance. With M1 on, create each guided type and test manual/prompt/auto policy, completion, skip, restart and postponement.
- [ ] Turn M1 off with a session open: the guidance stops, core lifecycle controls remain, and saved settings/history survive.
- [ ] Re-enable, reconnect, and switch accounts without stale frames or restored permissions from another account.

### M2 — Quick Capture, Inbox, then files

Enable text/links: `pnpm features enable quick_capture --env local`  
Enable attachments later: `pnpm features enable capture_files --env local`

**Built:** Core-owned capture, text/links/notes, atomic and idempotent todo + placement, existing-item scheduling, Inbox search/pagination, rich details, rescheduling and history preservation, retained local drafts, bounded private files and native export helpers. See [capture and rescheduling](capture-and-rescheduling.md) for the data model and limits. Drafts with files are retained when uploads are off; they are not silently stripped from a save. Existing file downloads/deletion stay authorized during rollback.

**Missing / unfinished:**

- [ ] Native acceptance for file choose/drop/paste, Save dialog cancellation/overwrite/error, Windows behavior, and interrupted requests.
- [ ] Production latency/storage/backup cost validation. Current files live in bounded database chunks, not a new large-file object-storage system.
- [ ] Broader accessibility and account-switch/restart acceptance of every capture/detail state.
- [ ] Product decisions about task depth and any future expanded-storage allowance. No new file paywall is implemented.

**Manual acceptance, in slices:**

- [ ] Text + link capture: shortcut, double Enter, save to Inbox, schedule an existing item, occupied/no-space cases, and retry without duplicates.
- [ ] Inbox: search, pagination, completion/drop, plan/postpone, day-crossing and DST behavior; confirm routine recovery still works with Inbox off.
- [ ] Files: exact downloaded bytes, all quota boundaries, removed/retained drafts, failure/retry, native chooser/export, and logout/account isolation.
- [ ] Disable just `capture_files`: no upload affordance, direct uploads/claims refused, existing authorized downloads still work.
- [ ] Disable capture while work exists: do not delete records; retain core scheduled-slot lifecycle and reopen the same data when preview resumes.

### M3 — larger routines, advanced controls, and paid launch

Enable: `pnpm features enable m3 --env local` (use a legitimate Pro test account for paid capabilities).

**Built:** Shared Free/Pro capability data, active-count enforcement, preference anchors, duration/day and count/week data/solver primitives, buffer/importance/grace fields, deterministic conflict repair, Stripe checkout/portal/webhook foundations, and grant/subscription resolution. The existing activity form supports daily count and a simple morning/afternoon preference—not every stored scheduling option.

**Missing / unfinished:**

- [ ] Final Pro price/allowance, comparison and checkout UI, billing-return route and customer-management experience.
- [ ] Founding-user eligibility, approved offer terms, automatic checkout discount, redemption/deadline tracking and customer messaging.
- [ ] Full advanced-control UI and round-trip semantics. Ranked candidate choices with consequence previews are not completed by enabling the flag.
- [ ] Consistent richer windows/spread/breather policy across schema, initial planner and repair; see [rearrangement](rearrangement.md).
- [ ] Explicit downgrade/over-limit behavior and migration of legacy premium settings; do not silently erase or reinterpret them.
- [ ] Live billing acceptance and legal/support/refund/renewal messaging.

**Manual acceptance:**

- [ ] Enabling flags on Free does not grant Pro. Pro allows the intended controls; direct API calls enforce both availability and entitlement.
- [ ] Each rule survives create/edit, initial placement, calendar repair, pause/resume, restart and downgrade.
- [ ] Turn the flag off: no new advanced settings or larger routine activations, but existing data/records survive.
- [ ] Test checkout, coupon application, webhook reorder/retries, portal, renewal, cancellation/refund and return URLs using the actual configured products before exposing paid signup.

### M4 — week visibility, then weekly planning

Enable the view: `pnpm features enable week_view --env local`  
Enable month separately: `pnpm features enable month_view --env local`  
Enable weekly planning later: `pnpm features enable weekly_planning --env local`

**Built:** Week/month grids, date/scope helpers, `/scope`, day-range settings/density, bounded range reads and calendar overlap display. Weekly minimum demand exists in the solver/data model. The weekly flag enables the existing future-day planning/materialization paths and gates writes of weekly minima.

**Missing / unfinished:**

- [ ] Full weekly-target authoring and cross-day planning/control UX. There is no whole-week optimizer hidden behind this flag.
- [ ] Final Free/Pro weekly packaging and enforcement. Existing manual future-day planning is a preview surface, not a newly completed paid entitlement.
- [ ] Timezone/day-boundary, DST, stale-response and offline date-cache findings; overview failure must not masquerade as free time.
- [ ] Range-settings commit isolation and responsive week/month layouts.

**Manual acceptance:**

- [ ] View-only preview does not materialize future routines; weekly planning does so only through its documented paths.
- [ ] Week/month ↔ day navigation, account/device zones on opposite sides of midnight, DST, range changes and slow failed responses.
- [ ] Weekly demand versus completed/kept sessions is correct, without duplicate future placements.
- [ ] Disable wider views and open their bookmarked URLs: return to Today without hidden page effects executing.

### M5 — progress, reflection and customization

Enable recap foundation: `pnpm features enable insights --env local`  
Enable customization work: `pnpm features enable dashboard_customization --env local`

**Built:** Day progress aggregates, completion/scheduled counters, Today-so-far widget, bundled day-so-far addon, widget capability keys and ordering helpers. Core progress data still supports “To place” even when recap UI is hidden.

**Missing / unfinished:**

- [ ] Weekly recap, longer-range trends/comparisons and their API/UI.
- [ ] Dashboard editor and persisted-layout integration. Several named secondary widgets are still placeholders/unrendered keys.
- [ ] Shareable recap output, preview and privacy defaults. No sharing feature should be advertised yet.
- [ ] Final insight entitlements; analysis is paid depth, while user-record access/privacy rights are not.

**Manual acceptance:**

- [ ] Completion is not inferred from scheduled time. Partial/auto/manual/missed/skipped records have honest labels.
- [ ] Recaps respect account timezone and date range, with offline/stale errors made explicit.
- [ ] Flag off removes insight/secondary widgets even from old cached plans, without hiding missed/unplaced recovery.
- [ ] Any future share preview excludes private calendar/task content by default and requires explicit user approval.

### M6 — reviewed community routines and authoring

Enable: `pnpm features enable community_addons --env local`

**Built:** Addon SDK/contract/tooling, bundled and reviewed-release models, catalog/management UI, permission enforcement, signed/hash-bound distribution foundation, explicit updates, rollback/safe mode and native authority helpers. Community trust/catalog are deliberately empty until actual reviewed releases are promoted.

**Missing / unfinished:**

- [ ] Public-kit publication, support/security channels, licenses/notices review and independent developer onboarding.
- [ ] Production trust roots/signing custody, R2 distribution, review/promotion ownership, and rehearsed revocation/incident response.
- [ ] Packaged adversarial isolation and permission/grant/update/revoke/safe-mode acceptance on each supported platform.
- [ ] Any paid-addon marketplace: seller onboarding, payouts, tax/refunds and commercial model are explicitly out of scope.

Use the full checklists in [addon launch](addon-launch.md); switching this flag on does not satisfy them.

**Manual acceptance:**

- [ ] Enable for only a reviewer account. A public account still cannot discover/install/run community code or call its endpoints.
- [ ] Enabling M6 does not bypass the separate first-party guided/capture/insight releases or hosted Pro entitlements.
- [ ] Disable M6 while an addon runs: frames/host authority unload, data remains, and re-enable respects current approval/grants rather than stale cached authority.

## 5. Rollback and legacy-data boundaries

These flags are release gates, not destructive migrations:

- Existing activity definitions, captures, files, schedules, grants and subscriptions are retained.
- Basic edits omit hidden advanced/session fields. Stored advanced preferences remain honored for existing definitions; a rollback does not silently rewrite someone's routine. This is deliberate grandfathering of data, not permission to create new advanced settings while off.
- Already scheduled captured/addon work remains visible as ordinary slots with core start/complete/skip/change-time controls. It must not disappear from the day because its creation workflow is hidden.
- Guided frames fall back to plain slots. New automatic guided starts stop when the flag is off; auto-started sessions already underway can be cleaned up. A newly user-started plain session is not marked complete by an old hidden auto policy.
- Safe file download/deletion APIs remain authenticated even when new uploads/capture are disabled. Turning off the entire Inbox hides its details UI; re-enable a recovery cohort or use support-assisted authorized access when needed. Do not describe a full self-service recovery/export UI as already built.
- A malformed/unavailable server configuration returns core-only. For transient client offline errors, a previously verified snapshot can remain visible within its five-minute in-memory lease; it never grants new access and failed refreshes never renew it. Expiry, restart, or account change returns to core-only. Drafts retain existing autosave guarantees, not a new guarantee against process termination before autosave.

## 6. Repeatable milestone workflow

1. Keep public defaults off. Enable only the milestone/slice being worked on locally or for your own dev account.
2. Read its built/missing section, finish the missing behavior, and add regressions to the relevant suites.
3. Test core-off, preview-on, account isolation, flag-off rollback and direct API refusal. Test paid entitlement separately where applicable.
4. Complete and record manual acceptance on the real supported platforms/providers. Record build/API versions, tester, date, issues and decision here or in a linked release issue.
5. Invite a small account cohort, then expand deliberately. Percentage rollout is not implemented; account overrides are the current mechanism.
6. Only announce general availability after the intended accounts can use the accepted feature. Use the copy in the [strategy](launch-strategy.md), not a promise that an unfinished flag unlocks a finished product.
7. Review usage, failures, support and operating cost, then decide the next milestone. Remove temporary overrides when no longer needed.

### Automated verification entry points

```sh
pnpm typecheck
pnpm test
pnpm test:features-cli
pnpm test:core-browser
pnpm test:capture-browser
pnpm test:addon-browser
pnpm test:release
```

- `packages/plans/src/features.test.ts`: default-off, strict parsing, dependencies, account overrides and first-party addon separation.
- `apps/api/src/features.test.ts`: authenticated snapshots, server refusal, cohort isolation, Free placement, pause/move, checkout and attachment rollback.
- `apps/api/src/features-background.test.ts`: core versus guided auto-start/completion behavior in the grace worker.
- `apps/desktop/src/lib/features.test.ts`: publication, failed reads, stale responses, session reset and refresh lifecycle.
- `apps/desktop/e2e/core-release.spec.ts`: actual local Worker/libSQL/browser core shell, preserved template library, direct URL/shortcut hiding, basic creation/pause, and a capture-only preview/rollback.
- Existing future-feature suites explicitly opt in. Core tests exercise real all-off defaults instead of changing the application's defaults to satisfy old tests.

### Implementation-pass verification

- Workspace typecheck and tests passed, including **239 API**, **397 desktop**, **34 plan/flag** tests and **5 CLI** tests.
- Full desktop browser suite: **36 passed** (core-off plus explicitly enabled future-feature workflows). Fixtures share a morning timezone so remaining-day placement is tested without depending on the operator's local hour; the API clock is not mocked.
- Standalone addon browser suite: **3 passed**. Native Rust unit tests: **25 passed**. Release-configuration tests: **9 passed**.
- Workspace build passed with the production API origin configured. This is not a signed installer or deployment.
- Actual local CLI enable → show → disable was exercised. Local global flags were left all-off; no remote configuration was changed.
- Changed code passes Biome. Repository-wide `pnpm lint` still reports two pre-existing errors in unchanged `packages/design/src/components.tsx` (mixed component exports and an effect dependency); those are not claimed fixed by this work.

Automated checks are not signed-installer, live OAuth/provider, live Stripe, production KV propagation or manual accessibility acceptance. No checkbox above is closed merely because the relevant unit suite is green.
