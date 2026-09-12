# Addon v1 launch: commercial app, open authoring kit

## Positioning decision for this implementation

Launch **Wise Routine the product**, with a small curated addon developer preview alongside it. Keep the application/backend private. Open the SDK, manifest contract, authoring tools, specifications and examples separately. Do not launch a paid-addon marketplace, unrestricted uploads, revenue sharing or third-party credential integrations yet.

Monetize the maintained product and hosted service: calendar coordination, supported planning/replanning, reliable account sync, polished native behavior and continuing operation/support. Open SDK code helps developers extend the product; it is not a free license to use the hosted service.

**Existing Free/Pro pricing and capabilities are unchanged.** Free currently allows two active activities and manual planning; Pro enables unlimited active activities, adaptive replanning and ranked rearrangement, plus its existing dashboard capabilities (`packages/plans`). Installing an addon does not upgrade the account. Re-enabling an addon's dependent activities now enforces the same active-activity limit transactionally. SDK-originated calls cannot invoke unrelated application endpoints.

Do not promise that an open extension ecosystem prevents someone from recreating a client-side premium widget or planning idea. Open-source licenses permit forks and commercial reuse. The defensible paid value is the service and product experience; enforce actual hosted entitlements server-side, not by making SDK source hard to obtain.

No new price, trial duration, addon paywall, developer payout or commercial redistribution restriction has been invented. If paid addons become important later, decide seller onboarding, tax/refunds, licensing, entitlement/revocation, revenue sharing, support and store-policy obligations as a separate product phase. An open-source addon can be sold, but recipients retain the rights its license grants; recurring revenue should not depend on forbidding those rights.

## Customer-facing copy (draft for launch)

**Short:**
> Wise Routine helps you make room for the work and routines that matter. Pro adds adaptive planning and more control as your day changes. We’re also preparing a small, reviewed addon program, with an open-source toolkit for developers.

**Only after the kit is actually public:**
> Build your own widgets and guided routines with our open-source addon SDK. Community distribution starts with a curated developer preview; Wise Routine subscriptions and hosted features remain separate.

**FAQ (after kit publication):** Is Wise Routine open source?
> The addon SDK, specifications, tools and examples are open source. The Wise Routine application and hosted service are separate commercial products. An addon's license does not include a Pro subscription.

Keep addons to a short extensibility note in the initial launch, not the main sales promise. Do not say “open marketplace,” “any integration,” “always running,” “guaranteed safe,” “all offline,” “paid developer earnings,” or “available on npm” until those claims are true. Do not promote prices or a trial duration before checking the actual billing configuration.

## Implemented launch foundations

- Collision-free account/addon storage namespace and uninstall prefix; per-addon key/value/total quotas. Old ambiguous keys are not adopted by whichever addon/account asks first.
- Exact installed release descriptors; signed community manifest/version/code/source/license binding; retained approved versions and explicit updates/rollback. Local bundled manifests must agree with server-installed metadata. Archived bundled manifests are retained separately.
- Stable frame connections for unchanged objects; release/grant/settings-keyed remounts. Session component identity survives shell refreshes. Selected activity-type key reaches the SDK.
- Auth-routing fields participate in permission comparisons. No background auto-upgrades; removed permissions drop on explicit version change; active sessions block version changes.
- Unknown/withdrawn releases fail closed; backend approval/enablement/grant checks share a transaction with addon writes. Periodic/focus/online refresh, bounded offline authority, native monotonic authority leases and local safe mode. A fully quit native app can also be started with `--safe-addons` to refuse addon activation before any frame runs.
- Atomically published native release snapshots with mandatory digest/metadata verification; explicit revision URLs, bounded file sizes/cache count. Legacy flat snapshots are not trusted by omission of a hash. Removal drops live host authority first and native authority before file deletion, even if cleanup fails. Frame URLs preserve route separators across Tauri's platform-specific URL conversion, with account-only decoding and strict revision validation.
- Bounded RPC payload/rate/concurrency, own-property method dispatch, contribution/key limits, SDK timeout/disposal, UTF-8 bundle limits and null bodies for bodyless proxy responses.
- Commercial-plan regression for addon re-enablement; source-oriented public authoring packages with license files/READMEs; standalone synthetic host, starter, validation and unapproved artifact packaging.
- Reviewed catalog/trust format, isolated-build guidance, trusted data-only approval command and controlled API/R2 distribution path. Community catalog/trust are intentionally empty.
- Addon-focused PR verification, catalog immutability check, public-kit CI template and browser conformance tests. Repository branch protection and production promotion remain operator configuration, not code assertions.

These are foundations, not a claim that arbitrary hostile native code has been exhaustively contained. Native resource isolation, OS credential storage and broader integrations are not solved merely by these limits.

## Release gates — do not skip

### Public developer kit

- [ ] Review the explicit MIT scope and upstream notices. Main app/backend are not included. Confirm trademark/privacy/distribution terms with counsel.
- [ ] Export into a fresh directory with `pnpm addon:kit NEW_DIRECTORY`; inspect for unintended files and the generated **public-only** dependency lockfile, then run its build/tests/typecheck without the private checkout.
- [ ] Create the public repository and publish actual support/private-security reporting channels, contributor guidance and protected review ownership.
- [ ] Decide npm organization ownership and trusted publishing. Verify packed JS/declarations/schema/README/LICENSE; publish only from the reviewed trusted workflow. Local packing is not npm publication.
- [ ] Have an external developer with no private-repository access build and submit an addon. A local clean consumer is necessary but not an independent developer onboarding test.

### Curated customer distribution

- [ ] Configure separate staging and production public trust roots/private signing custody. No test private key is a production release credential.
- [ ] Configure controlled R2 hosting and the API's `ADDON_BUNDLES` binding; verify real deployed authorization, CORS/CSP, size/hash failure behavior and retained artifacts.
- [ ] Establish a monitored submission/review/promotion process with isolated builds, dependency/license review and no build access to signing/npm/deployment secrets.
- [ ] Test real staging backend writes using reviewed descriptors and synthetic users; never re-enable production sideload authorization as a shortcut.
- [ ] On each supported packaged native platform: clean install; widget/Quick Add/both activity types; denied permissions; running-session update refusal; explicit grant update; rollback; revoke while running; five-minute offline lease expiry; account switch; interrupted install; tampered/missing hash; safe mode/recovery (including executable `--safe-addons`). Validate suspend/resume and no stale authority before announcing behavior guarantees. Adversarial child frames must be unable to invoke Tauri commands directly or access filesystem, shell, secrets or parent account state; browser sandbox tests and native helper tests alone do not establish that.
- [ ] Name an incident-response owner; rehearse revocation, operator rollback, trust-key rotation, support escalation and customer messaging.

Until these gates are met, ship only the bundled addons to customers and describe the external program as a developer preview/preparation. The empty community catalog/trust map enforces that conservative default.

### Main paid-app launch (separate outstanding work)

The addon work does not close the original audit. Before broad paid launch, resolve or explicitly mitigate the P0 social-sign-in handoff concern, validate actual signed installers/updater/notarization and deployed API/migrations, exercise live Stripe checkout/webhook/portal/cancellation/refund behavior with the intended prices, and complete billing/privacy/support/legal messaging. Choose and validate suspended-native scheduling guarantees. See `project-audit.md` and `releasing.md`.

The previous broader browser suite has failing selectors/Free-versus-Pro expectations; it was not silently relaxed here. Passing addon conformance tests is not a green end-to-end product suite or a full accessibility/security assessment.

## Verification record

Run the following after changes, bypassing caches for final evidence:

```sh
pnpm addon:verify
pnpm typecheck
pnpm exec turbo run test --force
pnpm test:release
pnpm test:addon-browser
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm addon:kit /tmp/a-new-public-kit
```

Tests cover signed metadata tampering/unknown keys/immutable versions, dotted namespace collisions and uninstall, storage/download limits, frame refresh/replacement, permission deltas, SDK disposal/deadlines/bodyless responses, unknown installed release refusal, Free-plan re-enablement rollback, native interrupted snapshot/hash/grant verification and expiring authority. Browser conformance uses the public SDK with the standalone synthetic host; it is not a packaged-native or live-distribution test. Do not mark unperformed operational gates done.

Latest local evidence:

- Forced workspace typechecks and tests: **34/34 tasks, 1,444 tests passed**.
- Native Rust tests: **24 passed**. JavaScript routing tests use Tauri's real macOS/Windows URL mocks, not packaged operating-system acceptance.
- Public-SDK browser preview: **3 passed**; release-configuration tests: **9 passed**; trusted promotion/export tests: **2 passed**. `addon:verify` also runs the four tools tests and catalog validation.
- Independently exported kit: frozen offline install with lifecycle scripts disabled, build, **156 tests**, and typechecks passed outside the private workspace. Current SDK/contract/tools tarballs installed in a separate consumer, with successful imports and CLI validation; a generated standalone starter also installed, built and validated. Before npm publication, use the documented local package overrides so pnpm does not resolve unpublished direct/transitive dependencies from the registry.
- Configured frontend dependency build: **22/22 tasks passed**, with all six bundled addons assembled.
- Changed-file checks and `git diff --check` passed. Whole-repository lint still has the original **two errors and one warning**; generated browser reports are excluded. Broader product E2E failures and other open audit findings have **not** been declared resolved.

This is local implementation evidence, not public publication, external-developer onboarding, production integration validation or a completed security assessment.
