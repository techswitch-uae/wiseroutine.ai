# First-release audit and implementation plan

Audited commit: `df0bfc4`. The original audit was read-only. The user subsequently
approved implementation of **phases 1 and 2 only**. Deployment, signing, live
acceptance and publication remain phases 3 and 4 and are not authorized by this
implementation pass.

## Executive assessment

The core is substantially tested, but it is **not ready for a public release**.
The largest remaining risks are release automation, account/session boundaries,
production configuration and native acceptance—not another scheduling rewrite.

This report distinguishes code/test evidence from live acceptance. It is not a
security certification or a claim that production services have been validated.

## Evidence at the time of the audit

Fresh checks:

- Release-configuration tests: **9/9 passed**.
- Feature-management CLI tests: **5/5 passed**.
- App browser inventory: **54 scenarios**.
- A simulated Rust version bump failed with `--locked`, confirming a release-path problem.
- Production website/app/API hostnames did not resolve from the audit machine;
  a control request to `example.com` succeeded.

Latest full runs available from the preceding implementation pass:

- App browsers: **53/54 passing**.
- Marketing browsers: **44/44 passing**.
- Scheduler, API, desktop, DB and native suites passed.

These results do not establish live signup, provider integration, signed
installation, updating or production tenant isolation. Counts above are a
historical baseline; implementation verification belongs at the end of this file.

## Confirmed issues

### A. Versioning can break the first release

Files: `release-please-config.json`, `.github/workflows/release.yml`,
`apps/desktop/src-tauri/Cargo.lock`.

Release Please updates `Cargo.toml`, but the configuration does not update
`Cargo.lock`. Changing `0.1.0` to `0.1.1` in a temporary manifest reproduced:

> cannot update the lock file … because `--locked` was passed

CI and release verification use `--locked`, so the version-bump PR can fail before
packaging. No release-eligible `feat:`, `fix:` or `perf:` commit subjects were
found since the configured bootstrap commit, despite Release Please relying on
Conventional Commits.

Plan:

- Test version synchronization across all version files, including the lockfile.
- Bootstrap the first release deliberately; do not rewrite existing history.
- Adopt an appropriate commit/PR-title convention for subsequent releases.
- Document the manual sequence: dispatch, review/merge the release PR, dispatch
  again. Merging alone currently does not trigger this workflow.

### B. Publication is not gated strongly enough

File: `.github/workflows/release.yml`.

Release verification runs unit/type/native checks, but not browser suites. It can
proceed independently of the known failing app E2E. Release Please creates the
release before installer builds finish; no final promotion requires all approved
artifacts and validation to succeed.

Plan:

- Require successful browser checks for the exact candidate SHA.
- Build and attach artifacts to a draft/candidate release.
- Verify signatures, expected platforms, public downloads and updater metadata.
- Publish/promote only after those checks pass.
- Add concurrency protection and an explicit approval boundary.

### C. Production configuration/deployment are incomplete

Files: `apps/api/wrangler.jsonc`, `apps/api/src/env.ts`, `apps/api/package.json`.

- Production contains placeholder database and Stripe configuration.
- Placeholder detection only checks values beginning with `REPLACE_WITH`, missing
  the marker embedded in the database URL.
- Deployment checks require Stripe and OneSignal configuration even though paid
  features are outside M0.
- API deployment commands do not themselves regenerate Prisma clients and embedded migrations.
- `/health/config` validates configuration, not database connectivity or migrations.

The configured updater URL returned 404. This may be expected before the first
release, but unauthenticated public artifact access must be verified, particularly
because documentation describes the application repository as private.

Plan:

- Environment-aware preflight before uploading anything.
- Required configuration matched to the released feature scope.
- Explicit generate → verify → migrate → deploy → smoke-test sequence.
- Validate hosting, DNS, account-app SPA fallback and marketing Node deployment.
- Verify installer/updater delivery without GitHub authentication.

### D. The privacy E2E needs two fixes

File: `apps/desktop/e2e/session-integrity.spec.ts`.

The test asserts removed explanatory copy and references undefined `toggle`, left
over from the previous control. Fixing the copy alone exposes the second failure.
`apps/desktop/tsconfig.json` excludes E2E files, so normal typechecking misses this.

Plan: assert persisted radio selection and actual redaction, typecheck browser
specs/configuration, and require a fully green app suite for release.

### E. Cross-tab account changes do not reset session state

Files: `apps/desktop/src/lib/session-lifecycle.ts`, `apps/desktop/src/lib/api.ts`.

Tokens/identity are read from shared local storage, but resets depend on calling
`changeSession()` in the current document. There is no cross-tab storage listener.
A focused probe confirmed an external token/identity change exposes the new
identity while leaving generation unchanged and invoking no reset callbacks.

This risks old account UI, requests or cache writes surviving under a changed
session. Existing single-document reset tests do not establish this boundary.

Plan:

- Reproduce with two actual browser pages.
- Coordinate cross-tab sign-in/sign-out and invalidate outstanding work.
- Fence requests/cache writes against captured account/token, not only generation.
- Test offline queues and delayed responses during account changes.

Resolve this before releasing the hosted app publicly.

## Low-hanging product issues

| Issue | Evidence | Proposed action |
| --- | --- | --- |
| Failed setup reads can count as completed steps | `setup-rail.tsx` treats calendar-read failure as connected and activity-read failure as enough activities. With hours confirmed it can permanently finish setup. | Keep failures unknown/retryable. Never persist completion from failed reads. |
| Windows lacks an explicit restore-window path | Close hides the window on all desktop platforms; dock reopening is macOS-only; tray offers Start and Quit but no Show action. | Add a cross-platform Show action/tray interaction before calling Windows supported. |
| Notification recovery disappears with setup | Permission is requested through setup; core Settings lacks recovery once setup finishes. | Native-only status/settings/retry control. |
| Release documentation is stale | `docs/releasing.md` says 15 user migrations, while current count is 16; `docs/launch.md` describes automatic placement on creation. | Reconcile instructions with tomorrow-effective routines and explicit placement. |
| First-use expectations need alignment | Launch plan promises an immediate placed activity; new routines correctly begin tomorrow. | Preserve the tomorrow rule; clearly explain the sample/preview and tomorrow expectation. |

## Contractual E2E coverage

Do not duplicate every scheduler unit case in a browser. Maintain an acceptance
matrix linking each product promise to unit/API tests, a browser journey and any
native/manual check.

| Contract | Baseline | Remaining coverage |
| --- | --- | --- |
| Three active definitions; repeats do not consume allowance | Covered | Acceptance in core-only mode. |
| Tomorrow-effective creation/edits; today unchanged | Strong API/date-navigation coverage | Actual midnight rollover while Today or Settings remains open, with coordinated browser/API time. |
| First Start until end; movement/Resume cutoff; same-slot identity | Strong | Keep mandatory release gates. |
| Full-length placement, spacing, stable healthy slots, passive Not placed | Strong solver/API coverage | Calendar ingestion → repair → actual UI journey, not only seeded final state. |
| Yesterday's shortfalls expire; saved one-offs survive | Covered across layers | Overnight/offline recovery journey. |
| Delayed/refused actions never claim false success | Several cases | Two-tab placement/action races and reconnect without duplication. |
| First signup and returning sign-in | Fixtures bypass authentication | OTP with controlled mail boundary, wrong/expired codes, provisioning failure/retry. |
| Account isolation | Single-document/unit protections | Two-tab switching, delayed responses, offline queues and separate user databases. |
| Privacy opt-out erases details and keeps them removed | API plus broken browser test | Reload, subsequent sync and stale-client state. |
| Recoverable setup | Limited | Failed reads, retry and truthful completion. |
| Production app behavior | Vite development mode + Chromium | Built-app smoke journeys and WebKit coverage. |
| Native install/update/background behavior | Rust models parts | Packaged-app acceptance on every advertised platform. |

Native clock expiry does not prove hidden-window calendar freshness. The tray
receives its schedule from the webview. Hidden-window Start, calendar changes,
sleep/wake and midnight need explicit native acceptance.

## Operational gates still open

These cannot be closed by browser mocks:

- Live emailed-code delivery and account provisioning.
- Google and Outlook consent, reconnect, revoked credentials and subsequent sync.
- Production tenant routing using genuinely separate databases.
- Matching updater keys, OS signing/notarization, clean install and actual update.
- Public privacy/terms/support destinations.
- Documented export/deletion, self-service or support-assisted for the first release.
- Backup/restore and rollback rehearsal against upgraded databases.
- Monitoring/ownership for failed sync work, dead-letter queues and support incidents.

Apple variables in a workflow are not signing evidence. Windows OS signing was
not configured in the audited workflow/Tauri configuration.

## Approved implementation plan

### Phase 1 — Restore a trustworthy release gate

- [x] Fix privacy E2E and typecheck browser tests.
- [x] Fix/test version synchronization.
- [x] Resolve/document first-release bootstrap (reviewed Conventional Commit; no version chosen or release dispatched in this pass).
- [x] Require browser results for the candidate SHA.
- [x] Correct stale release/migration instructions.

### Phase 2 — Close product trust gaps

- [x] Reproduce/fix cross-tab session changes.
- [x] Fix setup failure handling.
- [x] Add notification recovery.
- [x] Add a Windows-compatible restore path without claiming Windows acceptance.
- [x] Add authentication, calendar-repair, midnight and concurrency journeys.

### Phase 3 — Produce a reproducible release candidate (not started)

- Complete environment preflight and migration/deployment sequencing.
- Test the production-built app.
- Build signed candidate artifacts.
- Verify public downloads and updater metadata.
- Keep publication separate from building.

### Phase 4 — Live acceptance and promotion (not started)

- Run email/provider/native acceptance on the approved platform matrix.
- Rehearse update, rollback and recovery.
- Publish approved trust/support material.
- Promote only the verified candidate.

Do not add billing, guided sessions, hard time windows or other optional
capabilities to make M0 feel complete. Make the existing core reliably
installable, usable, recoverable and test-protected.

## Implementation progress and verification

**Phase 1 and 2 implementation is complete and locally verified** in the working
tree following `df0bfc4`. The original findings above remain the historical audit,
not a claim that fixed defects are still outstanding. No release was dispatched,
no version was chosen, and no deployment, installer signing or publication ran.

### Phase 1 delivered

- Privacy acceptance asserts the actual radio state and persisted redaction.
- Desktop typechecking includes app/addon browser specs and Playwright configs;
  marketing already includes its browser specs.
- Release Please updates the root crate's lockfile. A pinned updater regression
  applies a next version to temporary files and verifies `cargo metadata --locked`.
- Release builds depend on the complete reusable CI workflow at the exact release
  SHA. Dispatches must use main; candidate SHAs are validated. Builds attach to
  the explicit draft release ID, never a newly published lookalike release.
- Draft creation/tagging and publication are separated. Concurrency is guarded.
  First-release bootstrap and the two manual dispatches are documented in
  [releasing](releasing.md); the reviewed bootstrap commit remains an operator step.
- Launch/migration docs now say 6 directory / 16 user migrations and describe
  tomorrow-effective routines with explicit placement.

### Phase 2 delivered

- Storage/focus observation resets cross-tab sessions; request boundaries also
  check storage synchronously, so a late storage event is not a safety boundary.
  New credentials are verified before new account screens mount. Parallel
  bootstrap reads of the same token remain valid.
- Old account requests, cache writes, offline queues and setting-error rollbacks
  cannot affect the next account. Browser cases use two independent user databases
  and verify one persisted Start event after offline replay.
- Setup read failures remain unknown and retryable instead of recording completion.
- Native Settings keeps notification status, Allow and Check again available after
  onboarding, with system-settings recovery guidance; browsers offer no native prompt.
- The tray always offers **Show Wise Routine**, including when signed out or there
  is nothing to start. Actual OS restore behavior still needs phase 4 acceptance.
- Added **16 app browser scenarios**: real OTP verification/expiry/HTTP throttling,
  signup and provisioning retry; Google/Outlook-shaped ingestion and repair;
  cross-tab sessions, settings failure, offline replay and concurrent placement;
  midnight on Today/Settings, overnight reconnect and setup recovery.
- Controlled tests exposed and fixed additional real defects: expired OTPs were
  treated as wrong codes; code-screen service errors were not rendered; incomplete
  provisioning could strand an existing account; stale retained days still offered
  placement; an empty offline queue prevented the visible day refreshing on reconnect.
- Test-only clock/mail/provider/secondary-database behavior is covered by fail-closed
  production/no-secret/wrong-secret tests. Live delivery and production routing are
  not inferred from these substitutions.

The invariant-to-test map is [the core release acceptance contract](release-contract.md).

### Verification

| Check | Result |
| --- | --- |
| Full app browser suite | **70/70 passed** |
| Marketing production browsers | **44/44 passed** |
| Addon browser boundary suite | **3/3 passed** |
| API integration/unit suite | **307 passed** |
| Desktop unit/component suite | **476 passed** |
| Native Rust tests | **28 passed**; formatting passed |
| Release/config/version/workflow regressions | **13 passed** |
| Workspace typechecking | **19/19 tasks passed**, including browser specs |
| Workspace tests | **18/18 tasks passed**, plus **5 feature-CLI tests** |
| Targeted Biome check | Passed; no warnings/errors in the final check |
| Staged/unstaged whitespace checks | Passed |

One API run concurrent with both browser/build suites hit the existing five-second
cold-worker health-test timeout. The complete isolated API rerun and the subsequent
root workspace run both passed. No assertion or timeout was relaxed to obtain that.
One pre-existing view-preference scenario was changed to navigate through Today
and verify the saved result before reloading, rather than aborting a pending save
with an immediate full-document navigation.

**Still not public-release-ready:** phases 3/4 remain open, including built-app
WebKit/native acceptance, production configuration and hosting, public artifacts,
signing/updating, live mail/providers, data-rights/support operations and recovery.
The GitHub workflow configuration is tested locally; GitHub Actions itself was not
dispatched during this implementation pass.
