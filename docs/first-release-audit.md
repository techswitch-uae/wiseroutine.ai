# First release — remaining checklist

Updated **15 September 2026**, after local release-code verification.

**Not yet ready for public release.** This is the remaining work, in order—not
an audit history or ticket backlog. Completed implementation and local
verification work has been removed; live and candidate acceptance remain open.
The implementation/test contract is in [release-contract.md](release-contract.md).

Keep the launch at **M0**: three active activity definitions, Google/Outlook
calendars, and the existing core. Do not enable billing or later-milestone
features just to satisfy configuration checks.

## 1. Prepare and verify the deployed environments

- [ ] **Replace remaining production placeholders and configure core secrets.**
  The production Turso directory URL still contains `REPLACE_WITH_ORG`.
  Confirm the actual production database URL rather than guessing it. Configure
  the seven core secrets per environment; Stripe and OneSignal are intentionally
  undeclared for M0. Then rerun:
  ```sh
  pnpm --filter @wiseroutine/api preflight:dev
  pnpm --filter @wiseroutine/api preflight:prod
  ```
  Dev currently passes; production fails only on that directory URL placeholder.
  These are offline declaration checks, not proof that credentials work.
  Never deploy the browser-test `worker.vars` or enable `E2E_*` bindings remotely.
- [ ] **Verify hosting, DNS and HTTPS.** Check `wiseroutine.ai`,
  `app.wiseroutine.ai` and `api.wiseroutine.ai`. Deploy the marketing site's full
  Node `.output`, and verify the account app's direct-link/reload SPA fallback.
  Earlier DNS probes failed from the development machine; live readiness remains
  unverified, not a demonstrated global outage.
- [ ] **Rehearse the database rollout before production.** Take recoverable
  backups; explicitly select the intended directory and user databases; generate
  clients/migrations; verify; migrate; deploy; smoke-test. There are **6 directory
  and 16 user migrations**, including `0016_activity_schedules.sql`. Apply directory
  migrations before the new Worker and verify catch-up for existing user databases.
  The migration CLI can fall back to local `.dev.vars`/URLs—do not assume an
  environment was selected merely because a deployment command was.
- [ ] **Check real readiness after deployment.** Verify database connectivity,
  applied migrations, fresh provisioning and an existing-account upgrade.
  `/health/config` checks configuration, not connectivity or migration completion.
  API deployment now regenerates clients/embedded migrations and typechecks before
  upload, but that does not perform or certify the database rollout.

## 2. Produce a signed, immutable candidate

Follow [releasing.md](releasing.md) for the commands and configuration details.

- [ ] **Choose the first release version and bootstrap Release Please.** Merge a
  reviewed release-eligible Conventional Commit; use a reviewed `Release-As`
  footer if selecting an exact version. The current history still has no eligible
  `feat:`, `fix:` or `perf:` subject since the configured bootstrap point.
  Do not rewrite history or move existing tags.
- [ ] **Configure and verify signing material.** Supply the intended
  `VITE_API_URL`, matching Tauri updater public/private keys, and platform signing
  credentials. Verify macOS signing/notarization. Configure and verify Windows
  signing before advertising Windows support; a build target is not acceptance.
- [ ] **Run the two-dispatch candidate flow.** Dispatch Release on `main` to
  create/update the version PR; review and merge it after CI; dispatch again to
  create the draft/tag and build. Require the complete Verify workflow to pass
  for that exact tagged SHA. Leave the release a draft while acceptance is open.
- [ ] **Prepare installer and updater delivery.** Verify expected artifacts,
  signatures and matching updater metadata. Test unauthenticated candidate
  downloads/update delivery through an appropriate staging distribution path.
  GitHub draft assets require authentication, so an authenticated draft download
  is not proof of public access. The configured final `latest.json` URL previously
  returned 404 and must be checked again after promotion.

## 3. Complete live and packaged-app acceptance

Controlled browser/provider fixtures and Rust tests do **not** close these gates.
Record the candidate SHA, platform/version, result and evidence for each check.

- [ ] **Real email and account provisioning:** first signup, delivered OTP,
  returning sign-in, retry/recovery, and actual separate-tenant database routing.
- [ ] **Both live calendar providers:** consent, selection, new-calendar
  discovery, reconnect and revocation. Confirm provider changes reach the app and
  repair only eligible collisions without changing healthy appointments.
- [ ] **Live privacy recovery:** switch to Busy times only, verify erasure, then
  opt back in and sync. Confirm unchanged near/future meetings regain their
  details within the supported sync window, while event identity stays stable.
- [ ] **Signed installation and update on every advertised platform:** clean
  machine install, OS trust prompts, launch, matching updater verification, and
  an actual update from a previous installed candidate.
- [ ] **Packaged tray and window recovery:** Show/hide/restore while signed out
  and with no upcoming work; own slots and imported timed meetings; countdown →
  now → end/title clearing; long-name truncation; Google/Outlook labels. Meetings
  must not offer activity Start actions or start notifications. A stale Start
  menu must not start a different slot.
- [ ] **Native background/recovery behavior:** hidden-window calendar changes,
  sleep/wake, midnight, timezone changes, offline actions/reconnect and account
  switching. Test first Start until slot end separately from the movement/Resume
  cutoff. The native clock works from the schedule pushed by the webview; it
  does not by itself prove fresh calendar ingestion while that webview is asleep.
- [ ] **Notifications:** allow, deny, revoke, recover through Settings, and
  receive an actual OS notification. Rebuild/restart the native binary before
  testing; a webview refresh does not update Rust code.
- [ ] **Recovery rehearsal:** restore directory/user backups and roll back an
  application deployment against upgraded databases. Verify saved work and
  account ownership survive; define what to do if a migration or update fails.

## 4. Prepare support and promote

- [ ] Publish working privacy, terms and support destinations. Document the
  first-release export/deletion process, whether self-service or support-assisted.
- [ ] Assign ownership and alerts for sync failures, dead-letter queues, email
  failures and support/security incidents. Document escalation and rollback steps.
- [ ] Approve only the platforms/providers actually validated. Keep marketing
  installer metadata in preview until candidate acceptance is complete; existing
  signup links remain independent of installer availability.
- [ ] Publish the approved draft, immediately check final installer links and
  updater metadata **without GitHub authentication**, then update marketing
  availability/links. Stop promotion and follow the recovery plan if those checks
  fail. No deployment, signing or publication is authorized merely by this checklist.
