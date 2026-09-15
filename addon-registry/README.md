# Curated addon registry — operator runbook

`catalog.json` and `trust.json` are deliberately empty for community releases. That is a fail-closed launch default, **not an operating distribution service**. The six bundled addons remain available. `bundled-history.json` freezes their approved manifests so a server deployment need not silently change an installed release.

## Repository and trust model

- SDK/spec/tools/examples can be exported with `pnpm addon:kit NEW_DIRECTORY` and published independently. Do not open-source the main app/backend to provide authoring access.
- Public submission PRs contain source commit, lockfile/tests/license/support/privacy rationale and artifact digest. Every version gets human approval. App integration imports approved metadata only.
- Protect catalog/history/trust/promotion changes with named owners and branch protection. The added CI is verification, not a substitute for repository settings. Configure a monitored private security channel.
- Build untrusted source in isolated disposable jobs. Promotion must run trusted code, use no contributor commands/dependencies, and never share deployment/npm/signing credentials with builds. Do not use privileged `pull_request_target` or self-hosted production runners.

## Stage before production

1. Create a separate staging API database/configuration, R2 bucket, test accounts and app build. No live provider/Stripe credentials or real user data.
2. Generate an **operator-controlled test** P-256 signing key outside the repository. Keep its private PEM in a trusted secret store. Export only public JWK `{kty:"EC",crv:"P-256",x,y}` into staging `addon-registry/trust.json` under a bounded key ID. Build both API and client from that trust configuration.
3. Build an author submission from its pinned commit without promotion secrets. Preserve exact code, normalized manifest, payload, submission metadata and license. Review source and bytes independently; reject source/artifact mismatches.
4. Sign in the trusted stage:

   ```sh
   ADDON_APPROVAL_KEY_FILE=/secure/path/key.pem \
   ADDON_APPROVAL_KEY_ID=staging-1 \
     node scripts/approve-addon.mjs /reviewed/artifact /new/approval.json
   ```

   The command refuses mismatched manifest/digest and writes only a descriptor. It does not create keys, upload, publish or execute submitted code. Operator approval of source ownership/license/privacy cannot be inferred by the script.

5. Configure a Cloudflare R2 binding named `ADDON_BUNDLES` for the API. No bucket is provisioned or guessed by this change. Give the **separate uploader** write access; the serving service should have only the access it needs. Do not put bucket credentials in a client or addon.
6. Upload exact UTF-8 `addon.js` bytes as `<sha256>.js`. Never overwrite an existing digest object with different bytes. Store under controlled account/bucket hosting, not arbitrary addon-supplied URLs. The authenticated API serves `/addons/bundles/:hash` only for an approved, unrevoked catalog release and at most 2 MiB. Missing binding fails 503; unknown/revoked artifacts fail 404. Existing app API CSP/CORS applies; no broad CDN allowlist is added.
7. Append the descriptor to `catalog.releases`; set `catalog.current[id] = version`. Validate with `pnpm addon:verify`. Compare with the previous catalog: `node scripts/check-addon-catalog.mjs /previous/catalog.json`. Existing ID/version descriptors cannot change or disappear.
8. Deploy API catalog, matching client trust keys and bucket objects through the normal release process. Install as a synthetic user, verify Free/Pro limits and all native acceptance scenarios in `docs/addon-launch.md`.

Repeat with **separate production keys/bucket/configuration** only after acceptance and approval. An empty production trust map cannot authorize community code. First-party app signing/updater/notarization keys are different from addon approval keys.

## Upgrade, rollback, revoke

- Never change an approved descriptor in place. Publish a new version and digest. Keep old artifacts/descriptors; a current pointer does not replace installed code. The user explicitly installs/approves updates or rollback versions. Active activity sessions block version changes.
- Archive every released bundled manifest before changing it; never rewrite an existing ID/version's manifest. Bundled code still comes from the signed app, and must match the installed manifest. Older local app assets fail closed rather than pairing with a new server manifest. Users may need to update the app before choosing a newer bundled release.
- To withdraw all versions, add `id` to `catalog.revoked`; for one version add `id@version`. Deploy the API immediately, verify denied backend calls, and test frame/native authority shutdown. Keep the descriptor/artifact for audit/rollback analysis; withdrawal takes precedence over the current pointer.
- Clients refresh every 30 seconds while running, on focus and online. Community authority has a five-minute offline lease; native serving/fetch uses an independent monotonic lease. Already accepted writes, prior data access and arbitrary suspended-runtime behavior cannot be recalled. Safe mode is a local escape hatch. If addon code freezes the UI, fully quit the process (closing a tray window is not quitting), then start the installed executable with `--safe-addons`; native activation is refused before frames run. Set the device safe-mode toggle before restarting normally. Verify this recovery flow on packaged platforms before launch.
- Native release snapshots are bounded to 32 per addon and 32 installed addons per account. A full/tampered device cache must be repaired by deliberate removal/reset, not by weakening verification. Partial staging directories cannot activate. Legacy flat native snapshots/ambiguous local-storage keys are not migrated into trusted releases.
- During key rotation ship both public keys first, publish new approvals with the new key, and revoke compromised-key releases as appropriate. Historical descriptors stay immutable; retain historical verification keys, but prohibit new promotion with a compromised private key. Trust-key changes require an app release and security review.

## Explicit non-claims

No public repository, npm release, bucket upload, live community submission, production signing key or signed native acceptance has been performed automatically. The synthetic host is not staging and does not exercise the real backend, native CSP or OS process budgets. Do not announce an open marketplace based only on local tests.
