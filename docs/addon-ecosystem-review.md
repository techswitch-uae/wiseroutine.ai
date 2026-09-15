# Third-party addon readiness review

> Review baseline, retained as evidence. A subsequent implementation adds launch hardening and the standalone kit; see [addon-launch.md](addon-launch.md) for current scope, monetization positioning and outstanding operational gates. The reproductions below describe the reviewed baseline, not a claim that those bugs remain in the latest code.

## Verdict

Wise Routine has a credible addon runtime, not merely a future extension hook. Its six first-party addons exercise the same SDK, manifest format, frames, settings, and host bridge intended for external authors. Keep that architecture.

However, it is **not yet an end-to-end third-party publishing platform**. The current registry only enumerates bundled addons; external-author development, reviewed releases, version-correct installation, update activation, and revocation need more work. Several concrete isolation/lifecycle defects should be fixed before running strangers' addons on customer accounts.

**Recommended launch model:** a public authoring kit and a curated, source-reviewed registry. Do not start with arbitrary uploaded JavaScript or automatic publisher self-service. The main application and backend can remain private.

## Review evidence

Reviewed `docs/addons.md`, both public-package candidates, the JSON Schema, all contribution types, the browser host/frames, native installation/fetch/secrets, the Worker registry and installation/authorization routes, database addon lifecycle, and representative first-party examples.

Checks performed:

- Existing addon-contract tests: **50 passed**.
- Existing SDK tests: **17 passed**.
- Existing desktop addon tests: **52 passed**.
- Four temporary diagnostic probes **reproduced the current defects** described in R1–R4. These were not tests asserting safety; their passing means the defective behavior was observed. The probes used synthetic data and were removed afterward.
- Packed `@wiseroutine/addon-sdk` and `@wiseroutine/addons` using pnpm, installed the tarballs into an independent temporary project offline, and successfully imported both packages. Nothing was published to npm.

No application source was changed for this review. Native hostile-code execution, network-exfiltration testing, production publishing, and live third-party OAuth were not validated. The native/network findings below are source-review conclusions, not claims of a verified sandbox escape.

## What already exists

| Area | Current support |
| --- | --- |
| Author-facing SDK | Typed `connect()` client and MessagePort RPC; no runtime dependency on the private app |
| Contribution points | Rail widgets, guided activity/session types, Quick Add handlers, declarative addon/activity settings |
| Capability model | Shared host/Worker checks, separate requested and approved capabilities, own-slot ownership checks |
| Isolation | Opaque-origin iframe with `sandbox="allow-scripts"`, per-frame CSP, no bearer token intentionally passed to addons |
| Native networking | Origin-checked fetch proxy, no redirect following, 30-second request timeout, 5 MiB response cap, credential injection |
| User controls | Install/remove/switches, permission descriptions, additional-permission approval, dependent-activity impact confirmation |
| Integrity | SHA-256 checks in the browser loader and native installer/server |
| Account separation | Account-scoped addon storage and native addon directories/secrets |
| Examples | Six real addons; `breathing` is a simple session, `todos` exercises writes and Quick Add, `day-so-far` exercises reactive cards |
| Package distribution groundwork | Public publish configuration and working standalone tarball imports |

Key implementation references: `packages/addon-sdk/src/index.ts`, `packages/addons/src/index.ts`, `apps/desktop/src/addons/`, `apps/desktop/src-tauri/src/addons.rs`, and `apps/api/src/routes/app.ts`.

### Be precise about the supported use cases

This is a browser-JavaScript extension system, not native plugins with filesystem, shell, Node.js, or unrestricted Tauri access.

It can already support custom guided routines, day-summary cards, external-service widgets, and todo/Quick Add integrations. It does not currently provide third-party OAuth, arbitrary app routes, scheduler replacement, activity creation through the SDK, or calendar-provider registration.

`wr.day()` exposes today's activity/task slots, including their titles—not a full calendar-event feed. `write:todos` can act on the user's todo list, not just records created by that addon. A session addon can finish the particular session the host assigned it. These distinctions need to be explicit in both the specification and consent UI.

## Required fixes before third-party customer installs

### R1. Addon-local storage is not collision-safe — reproduced

**Reference:** `apps/desktop/src/addons/host.ts`, `storeKey`; `installed.ts`, `forgetAddon`.

The effective key is built from `wr.addon.<addonId>.<key>`, inside the account namespace. Both addon IDs and storage keys may contain dots.

These two valid callers address the same key:

```text
addon: review.alpha.beta    key: token
addon: review.alpha         key: beta.token
```

Using the real host bridge and synthetic MessagePorts, the second addon read and overwrote a value stored by the first. Neither needed a capability, because addon-local storage is always available. Prefix-based removal has the same ambiguity and can match another addon's storage.

Account scoping does not solve this separate addon-identity collision. Use an unambiguous tuple encoding, or a separator forbidden in both validated components, consistently for get/set/remove. Add adversarial tests with nested IDs, reserved-prefix lookalikes, and uninstall prefix matching.

### R2. Installed manifests can be paired with a different release's bundle — reproduced

**Reference:** `apps/desktop/src/addons/installed.ts`, `loadAddons`/`load`; Worker `GET /addons` and `GET /addons/available`.

The installed list supplies the installed manifest. The loader independently finds the current catalog entry **by ID only** and uses that entry's bundle URL and hash. A diagnostic with installed version 1 and catalog version 2 loaded version-2 code under the version-1 manifest.

The hash check succeeds: it checks against version 2's hash. The missing invariant is that manifest, code, grant evaluation, and installed version refer to the same release.

Make an immutable release the unit of installation:

```text
addon ID + version + API compatibility + manifest digest + bundle digest
```

Return the exact installed release's download metadata. Keep old approved releases available. Make upgrading explicit even if no new permissions are requested, and preserve a known-good version for rollback. Bundled addons also need a strategy for a newer server manifest meeting an older installed app bundle.

### R3. Reloading an addon does not reliably reload its document/connection — reproduced in web mode

**Reference:** `apps/desktop/src/addons/frame.tsx`.

`srcdoc` is captured once with `useState`. The MessagePort effect depends on the addon object, while a new port is transferred only on the iframe's `load` event. `loadAddons()` produces new addon objects, but the rendered widget/background keys and native frame URL do not include a release identity.

A rerender probe showed that version-2 props retained version-1 HTML and did not send a new handshake. The old effect closes its port. The corresponding same-URL lifecycle is also a concern for native frames, although that was not reproduced in a packaged app.

Choose one coherent lifecycle: stable ports with explicit settings/context updates, or deliberate frame remounts keyed by a release/grant generation. Do not close a port and wait for a navigation that never occurs. Define update behavior during an active session; test settings saves, permission changes, upgrade/downgrade, and disable/re-enable.

### R4. Permission differences ignore credential-routing changes — reproduced

**Reference:** `packages/addons/src/index.ts`, `canAddon`, `coveredBy`, `ungranted`.

For `net:fetch`, permission comparison checks origins but not the `auth` secret/header/prefix. A probe changed the secret and header while retaining the origin; `ungranted()` returned no new permissions.

The native proxy still uses the stored grant, so this does **not** establish that the changed credential routing silently becomes active. It does establish that the approval/update machinery cannot accurately explain or handle the change.

Normalize and compare all security-relevant grant fields. Require explicit approval for expanded authority or changed credential destinations/use. Specify what happens to permissions removed from a manifest, and distinguish required from optional permissions if partial grants remain supported.

### R5. Revocation is incomplete for removed entries and long-running frames — source review

**Reference:** `apps/api/src/routes/app.ts`, `asAddon` and `GET /addons`; `apps/desktop/src/addons/installed.ts`; `host.ts`.

The Worker condition checks `entryFor(id)?.revoked`, but does not reject a missing registry entry. Removing an entry is therefore not equivalent to an explicit revocation for an already installed, enabled row. The installed-list response also only marks an explicit `revoked: true`.

Explicit revocation prevents supported proxied API writes once checked. It does not immediately close a running frame or remove its access to cached host reads, local storage, or native third-party fetch. Addon loading is not a bounded periodic revocation check.

Fail closed on unknown/withdrawn releases, publish explicit revocation records, refresh revocation state on a bounded schedule, and close affected ports/frames. Decide an offline revocation grace policy rather than promising instantaneous revocation while offline. Disable/remove/revoke and dependent-activity changes should also become transactional; the current addon repository operations are multiple writes.

### R6. The actual external-release distribution path is missing — source review

**References:** `apps/api/src/addons/registry.ts`; `apps/desktop/src-tauri/tauri.conf.json`; `apps/desktop/src/addons/installed.ts`.

`registry()` currently builds entries only from the six bundled manifests. `RegistryEntry` has fields suitable for community releases, but no community catalog ingestion/submission/promotion path exists. `isListable()` is a minimal internal guard, not a submission validator: a 64-character string is not necessarily a valid digest, and release identity/URL consistency is not fully checked.

The production parent CSP permits the Wise Routine API origins, not arbitrary bundle-hosting CDNs. The parent loader's `fetch(bundleUrl)` is not authorized by an addon's own `net:fetch` grant. Simply adding a GitHub Releases URL to a registry entry is not a complete production installation solution.

Host approved artifacts on a controlled, immutable origin, explicitly allow that origin in the parent CSP, configure CORS, and validate all catalog entries. For a first curated release, a reviewed JSON catalog deployed with the Worker is sufficient; a marketplace service is not necessary.

Hashes establish byte agreement with the catalog, not authorship or approval independently of it. A stronger release design signs a descriptor containing the manifest and bundle digests, identity, version, and compatibility, with a Wise Routine approval key. An author's signature alone is not your review approval.

### R7. Resource and protocol limits need to assume hostile callers — source review

**References:** `host.ts`, `frame.tsx`, `packages/addon-sdk/src/index.ts`, native `addons.rs`.

Existing limits are useful but incomplete:

- Storage is bounded per value, not by total addon storage or key count. It shares the host's localStorage quota with important application state.
- There is no general per-addon RPC rate/concurrency/payload budget.
- Capability and contribution arrays lack complete count/uniqueness limits; too many contributions can mean too many frames.
- Bundle downloads lack an explicit size/deadline budget.
- SDK connection has a timeout, but ordinary RPC calls can wait indefinitely after disconnection.
- The RPC method lookup uses a plain object without an own-property check; malformed calls should not reach inherited methods or escape dispatch error handling.
- `sandbox="allow-scripts"` is not a dependable CPU/memory/process budget. A synchronous infinite loop needs platform-level consideration, not just a timeout in that same JavaScript environment.

Add budgets, typed wire validation, safe dispatch, cancellation, diagnostics, and a safe-mode/disable path. Adversarial real-browser/native tests should exercise navigation, embedded frames, redirects, flooding, and attempted parent/IPC access. Do not present permission checks as proof against all availability or data-egress abuse.

### R8. Native installation needs atomic, fail-closed release activation — source review

**Reference:** `apps/desktop/src-tauri/src/addons.rs`, `install_addon`, `serve`, and secret writes.

Manifest, grant, bundle, and hash are overwritten separately. Serving treats a missing/unreadable hash as empty, which skips verification. That is not a sound recovery rule for downloaded code during an interrupted update.

Stage a complete verified release, then atomically activate it. A missing hash for a community release must refuse execution; the bundled exemption must be explicit trusted metadata, not inferred from an unreadable file. Store secrets in the OS credential store where possible; otherwise use atomic writes and appropriate protection on every supported OS.

## Make the public developer experience real

### The SDK packages are a good extraction boundary

Both package tarballs worked outside the monorepo. This is meaningful evidence that authors do not need to import private application modules.

However, the packed SDK contained only built code, declarations, and package metadata. Its advertised README is absent. Both packages declare MIT in metadata, but actual license files and a contributor/security policy need to be provided. This review did not establish whether npm releases or the public schema URL are deployed.

Publish a small public repository containing:

```text
packages/sdk/           # current addon-sdk
packages/manifest/      # current addons contract and schema
packages/dev-host/      # standalone preview with realistic fixtures
packages/cli/           # create, dev, validate, pack
examples/               # current first-party examples plus a network example
spec/                   # normative manifest, wire, permission, lifecycle docs
LICENSE
CONTRIBUTING.md
SECURITY.md
```

The names and CLI commands above are proposed, not existing tools. Shared production/dev-host conformance tests matter more than the exact repository layout.

### Current sideloading is not a complete external-author workflow

`VITE_ADDON_SIDELOAD` runs only in a development build. The documented command expects this application's development environment; it is not a public, standalone addon runner.

Furthermore, it only loads the addon locally. It does not register/install that ID in the server registry/user database, so backend-proxied writes for a new external ID are rejected by `asAddon`.

Provide:

1. A standalone host with synthetic sessions, todos, settings, permissions, and clock controls for fast local work without calendar credentials.
2. A staging/test-account path for exercising real backend writes and installation rules.
3. A clear distinction between untrusted local development loading and approved customer distribution. Do not weaken production registry authorization to make sideloading convenient.

### Tighten the specification before promising stability

The handwritten parser, JSON Schema, TypeScript declarations, and prose are not fully aligned. Examples include activity-level secret fields allowed by the schema but refused by the runtime, differing origin validation, and out-of-range canvas values rejected by the schema but clamped by the runtime. Add one source of truth or differential conformance tests.

Two concrete author-facing API gaps also deserve attention:

- Manifests permit multiple activity types, but the session role/session payload does not identify the selected activity-type key. Widgets receive a widget key; sessions need an equivalent discriminator.
- `wr.fetch()` always constructs a `Response` with a string body, including for 204/205/304 responses that require a null body. Its proxy is UTF-8/string-oriented and does not implement all `RequestInit` semantics. Fix the bodyless-response case and document/type the supported subset instead of implying complete browser-fetch equivalence.

Define API compatibility, supported platforms/features, errors/timeouts, settings migration, event delivery, update activation, and active-session behavior. Keep API version distinct from application version and addon release version.

### Explain authority honestly

Origin permission is broad: access to an approved API origin can include destructive methods, not just reads. Keeping a secret out of the direct SDK response is useful, but does not reduce the authority of requests made with that secret or guarantee a remote endpoint never reflects it.

A grant to read todos plus access to an external service can legitimately permit sending those todos there. That must be understandable in the review checklist and consent UI. Correct the current prose that says addons cannot read the user's own slots while `read:schedule` intentionally exposes them.

## Recommended submission and release process

Start with a public registry repository and pull requests, not a publisher portal.

1. **Author prepares a release:** source repository, immutable commit/tag, manifest, lockfile, tests, screenshots, license, support contact, and privacy/network explanation.
2. **Submission checks:** validate ID ownership, version/compatibility, manifest/schema, contribution keys, permission deltas, package/bundle size, forbidden runtime imports, and dependency/license information.
3. **Isolated build/test:** build the submitted commit in an ephemeral unprivileged environment. Test denied permissions as well as happy paths, and compare against the host conformance suite.
4. **Human approval:** review source and dependencies, network destinations, credential usage, user-facing claims, destructive actions, and resource behavior. Require review of updates too.
5. **Trusted promotion:** transfer validated artifacts—not executable publisher scripts—to a separate publishing/signing stage. Generate/sign release metadata and upload immutable artifacts to Wise Routine-controlled storage.
6. **Catalog rollout:** expose the approved release, retain older approved versions, apply the update/permission policy, and support rollback/revocation.
7. **Operate the program:** maintain vulnerability reporting, owner transfer rules, abandoned-addon handling, and user-visible reasons when an addon is blocked.

Never run submitted code or dependency lifecycle scripts with production, npm, signing, or deployment credentials. In particular, avoid using privileged `pull_request_target` workflows to check out and execute an untrusted PR. A hash of a malicious build is still a perfectly valid hash.

### Suggested initial defaults

- Source-visible submissions and verified repository ownership.
- Manual approval of every published version.
- Open-source the SDK/specs/examples/dev tooling; keep the product/backend private if desired.
- No arbitrary native code or production sideloading for ordinary users.
- No marketplace/payments dependency for the first release.
- Start with a small set of invited authors; restrict credential-bearing integrations until their review/storage story is ready.
- Keep the current SDK deliberately narrow rather than adding every requested permission up front.

### A useful launch acceptance test

Have an external developer, with **no access to the private repository**, build one addon containing a widget, Quick Add handler, and guided session; exercise an optional denied permission; submit an immutable version; install it on a clean desktop; update it; revoke it while the app is running; and verify account isolation and recovery from an interrupted update.

Until that path passes, documentation and a working first-party demo are not sufficient evidence of third-party readiness.
