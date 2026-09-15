# Core release acceptance contract

Scope: **M0**, with later milestones disabled by default. Changes to these rules
require an explicit product decision and corresponding test/doc changes—not just
updating expected values until CI passes. [Activity planning](activity-planning.md)
is the detailed scheduling specification. [The release audit](first-release-audit.md)
tracks remaining operational work.

The release workflow must verify the exact candidate SHA through the complete
Verify workflow before building installers. Passing automation produces a draft
candidate, not permission to publish it.

| ID | Required behavior | Automated acceptance / lower-level evidence |
| --- | --- | --- |
| CORE-01 | Free allows three active activity definitions, not three occurrences. Hidden later milestones are not prerequisites for the core. | `apps/desktop/e2e/{activities,core-release}.spec.ts`; API feature/plan tests |
| ROUTINE-01 | New activities and routine edits take effect on the next account-local date. Repeated edits replace tomorrow's choice; today/history stay unchanged. | `e2e/day-routine.spec.ts`, `e2e/rollover-setup.spec.ts`; API `planning/day-routine.test.ts` covers DST/date/timezone boundaries |
| ROUTINE-02 | Reading any date creates no slots or plan runs. Placement is explicit and preserves accepted appointments. | `e2e/day-routine.spec.ts`, `e2e/routine.spec.ts`, `e2e/rollover-setup.spec.ts`; API placement tests |
| ROUTINE-03 | Repetitions spread, full durations survive, calendar occupancy is not borrowed. Breathing room is preferred, not a reason to shorten slots. | Scheduler `rules-contract.test.ts`, `routine.test.ts`, planner/repair suites; `e2e/routine.spec.ts` |
| SLOT-01 | First Start remains available strictly until scheduled end and never extends the appointment. Resume/movement close at start + two minutes or end, whichever is sooner. | `e2e/late-start.spec.ts`, `e2e/slot-actions.spec.ts`; scheduler `slot-actions.test.ts`, API `slot-window.test.ts` |
| SLOT-02 | Early Stop is an actual-Start undo window, not a renewed movement window. Eligible postponement keeps the same slot. Clock passage does not invent manual outcomes. | Same lifecycle browser suites; API lifecycle/background tests and native tray clock tests |
| PLACE-01 | Not placed is passive; saved work precedes fresh demand without duplication. Daily shortfalls do not accumulate across days; explicit saved one-offs survive. | `e2e/{routine,day-routine,rollover-setup}.spec.ts`; DB/API day accounting tests |
| PLACE-02 | Initial placement and collision repair share geometry. Repair only changes affected eligible slots; healthy appointments stay put. | Scheduler contract tests, API `sync/realign.test.ts`, `e2e/calendar-repair.spec.ts` for Google and Outlook-shaped deliveries |
| SESSION-01 | Switching/signing out in another tab clears old account UI, cancels/fences late work, and verifies new credentials before showing that account. A previous account's setting failure cannot roll back the new one. | `e2e/session-boundaries.spec.ts`; desktop `session-lifecycle.test.ts`, `reliability.test.ts` |
| SESSION-02 | Offline actions remain owned by their account, retain action time/idempotency and replay once. Another account cannot read or drain them. | `e2e/session-boundaries.spec.ts` uses separate fixture databases and checks persisted Start events; API integrity/idempotency tests |
| TRUST-01 | OTP generation, verification, expiry and HTTP rate limits are real. Failed provisioning yields no usable session; retry repairs an existing incomplete account. | `e2e/authentication.spec.ts`; API `otp.test.ts` separately covers the code-attempt budget beyond HTTP rate limiting |
| TRUST-02 | Busy times only erases details and fences later syncs while enabled. Explicit opt-in invalidates incremental cursors; the next sync restores unchanged meeting details within the supported window, without changing event identity. | `e2e/session-integrity.spec.ts`, `e2e/calendar-repair.spec.ts`; API `privacy-sync.test.ts` (both providers, pagination, stale fetches and rollback), integrity/privacy tests |
| RECOVERY-01 | Failed setup reads never count as completion. Retry can recover. Notification permission is optional, explicitly requested and recoverable from native Settings. | `e2e/rollover-setup.spec.ts`; setup/notification-settings component tests |
| RECOVERY-02 | Midnight updates operational Today even on Settings. An offline retained day is marked stale, cannot place work, and refreshes on reconnect even with an empty action queue. | `e2e/rollover-setup.spec.ts`; Today controller and Not placed unit tests |
| RELEASE-01 | Root/Tauri/Cargo versions agree. The real Release Please update leaves Cargo.lock usable with `--locked`. Installer jobs consume the verified SHA and draft release ID. | `scripts/release-{version,workflow,config}.test.mjs`; E2E/config typechecking included in `pnpm typecheck` |
| RELEASE-02 | Normal desktop builds reject absent/incomplete static shells and entry assets. Candidate Verify runs production-built Chromium and WebKit, not just Vite dev mode. | `scripts/check-desktop-build.test.mjs`, `scripts/release-workflow.test.mjs`, `pnpm test:app-built` |
| NATIVE-01 | Show Wise Routine is always in the tray menu. Timed imported meetings share the countdown, but never receive activity Start actions/notifications. Slot Start expires at scheduled end and sends its exact id. | Rust compilation/clock tests and desktop `alerts.test.ts`; **actual Show/hide/restore and notification behavior require packaged OS acceptance** |

Browser spec paths above are under `apps/desktop/e2e/`. Scheduler sources/tests are
under `packages/scheduler/src/`; API tests under `apps/api/src/`.

## What the controlled boundaries do not prove

- The mail sink replaces delivery only; it does not prove Resend domain setup or
  deliverability. Tests do not supply a universal OTP or bypass Better Auth.
- Calendar tests replace provider transport/credentials with controlled pages.
  Production normalization, event storage/privacy fences and the worker's shared
  ingestion/repair orchestration run. Live OAuth, webhooks, token refresh and
  eventual delivery need provider acceptance.
- Two test tenants use independent disposable user databases through an explicitly
  gated local mapping. This proves client/session/data separation for those cases,
  not production Turso hostname routing or infrastructure authorization.
- Clock injection and test data/inspection endpoints require the existing three
  locks: non-production, configured E2E secret, matching request secret. Runtime
  clock/mail/provider/secondary-database substitutions are inert in production,
  including when an E2E binding is accidentally supplied.
- Chromium app tests do not stand in for production-built WebKit/Tauri, AppKit,
  Windows, signing, install/update or sleep/wake tests. These remain live and packaged-candidate gates.

## Publication checklist

Automation must be green for the tagged candidate. Then separately verify public
hosts and artifact access, both live calendar providers, email signup/returning
sign-in, schema rollout/recovery, signed installation/updating, native lifecycle,
privacy/support/data-rights operations and rollback. Keep failed/incomplete
candidates as drafts; do not move an existing release tag to repair a build.
