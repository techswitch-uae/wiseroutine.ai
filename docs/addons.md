# Addons

Addons extend Wise Routine with widgets, guided activity types, Quick Add rows and declarative settings. Six first-party examples use the same host boundary. The app and hosted service remain proprietary/commercial; the SDK, contract, tools and examples are a separately MIT-licensed authoring surface.

**Start here:** [standalone authoring kit](addon-kit/README.md), [API-1 specification](addon-kit/SPEC.md), [submissions](addon-kit/SUBMISSIONS.md), [security](addon-kit/SECURITY.md). [Launch readiness and monetization](addon-launch.md) distinguishes implemented safeguards from deployment gates. The [ecosystem review](addon-ecosystem-review.md) records the original findings, not current implementation status.

## Supported contributions

| Contribution | Manifest field | Host behavior |
| --- | --- | --- |
| Optional card | `widgets` | Host frame, addon contents, bounded eyebrow/height |
| Guided session | `activityTypes` | Host-controlled timing/Done/Stop; declared settings in the activity form |
| Quick Add row | `quickAdd` | Receives selected contribution key, title and optional minutes |
| Addon settings | `settings` | Host-rendered form; values through `wr.settings()` |

The initial community preview accepts `ui:widget`, `ui:session`, `read:schedule` for today, `read:todos`, `write:todos`, `write:own`, and `notify`. It **does not** accept network/embedding/external-link/background-wake capabilities or secret fields yet. The full contract still includes those capabilities for first-party/future integrations; their presence in types is not launch approval.

- `wr.day()` reads today's activity/task slots, including titles and `ownedByYou`; not calendar-event details.
- `wr.placeSlot()` and `wr.setSlotStatus()` act on addon-owned slots. `wr.finishSession()` only finishes the assigned session.
- `wr.todos.*` permissions concern the user's todo list, not only addon-created records.
- `wr.card()` presents the selected widget. A session receives its selected `activityTypeKey` in role/context.
- `wr.store` is account/addon-scoped device JSON storage, not a credential vault: 64 keys, 16 KiB/value, 256 KiB total. It can fail when full/unavailable.
- Role, theme, host/API versions and change/Quick Add listeners are part of the SDK. Use `dispose()` for teardown; ordinary RPC has a deadline.

No SDK API creates activities, registers calendar providers, replaces the scheduler, draws outside its frame, accesses Node/filesystem/shell/Tauri or obtains account/provider tokens. Hosted features remain subject to server-side plan limits. Re-enabling addon activities also rechecks the Free activity limit.

## Boundary and releases

An opaque-origin `<iframe sandbox="allow-scripts">` gets one parent-owned MessagePort. The native `addon:` document and web `srcdoc` carry restrictive CSP. Never add `allow-same-origin`. Host RPC validates capability, role and payload budgets; backend calls recheck exact approved release, enablement, grant, endpoint and slot ownership inside the mutation transaction.

An iframe is not a CPU/memory/process guarantee. Even with review, read authority reveals data to third-party code. Network/credential authority can enable data egress and destructive remote requests; secret injection is not a guarantee that a remote server cannot reflect the secret.

Community releases bind manifest, version, digest, source, license and author in an approved P-256 signed descriptor. The client uses the exact installed release, not the latest catalog entry sharing an ID. Downloads use the configured API origin and controlled bucket. Hashes and signatures do not replace source/license/privacy review.

Upgrades/rollback are explicit, preserve narrowed grants, drop removed permissions and surface new/auth-routing changes for approval. Active activity sessions block version changes. Ordinary refreshes preserve frame connections; a release/grant/settings change deliberately remounts. Bundled manifests must match local signed-app assets; older retained manifests live in `addon-registry/bundled-history.json`.

Native installation stages complete verified immutable snapshots and atomically publishes a revision directory. Every serve rechecks manifest/grant/bundle identity and a mandatory hash, including locally bundled code. Native activation uses the approved revision in the frame URL plus an expiring in-memory authority lease. Missing hash does not mean trusted.

Approval refresh occurs on startup/focus/online and every 30 seconds; community authority expires after five minutes without verification. Native serve/fetch checks also expire independently. Revocation can stop running sessions; it does not undo already accepted writes. Device safe mode stops all addon frames without deleting account activities. Suspended-webview behavior still requires packaged-native acceptance; no always-running-service promise is made.

## A minimal community widget

```json
{
  "id": "yourname.pause",
  "name": "A small pause",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Make room for the next thing.",
  "capabilities": [{ "kind": "ui:widget" }],
  "widgets": [{ "key": "pause", "name": "A small pause" }]
}
```

```ts
import { connect } from "@wiseroutine/addon-sdk";
async function main() {
  const wr = await connect();
  if (wr.role.kind !== "widget") return;
  document.body.textContent = "Breathe. Make room for the next thing.";
  await wr.card({ eyebrow: "A small pause", height: 160 });
}
main().catch(error => { document.body.textContent = error.message; });
```

Build a self-contained IIFE at `dist/addon.js`. The CLI starter includes Vite configuration. In the private integration checkout:

```sh
pnpm addon:verify
pnpm addon:kit /tmp/wiseroutine-addon-kit  # target must not already exist
```

Then use only the exported directory: `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm addon preview addons/breathing`.

The previous `VITE_ADDON_SIDELOAD` app hook has been removed. It could not authorize real backend writes and was not a standalone developer workflow. Use the synthetic host for iteration and a separately configured **staging app/API, test keys and reviewed catalog** for integration. Never loosen production authorization for development.

## Publishing is a separate operation

No command here publishes to npm, creates a public repository, uploads code or installs production signing keys. `wr-addon package` produces an **unapproved** artifact. Human-reviewed isolated builds and trusted promotion are described in [SUBMISSIONS.md](addon-kit/SUBMISSIONS.md) and [the operator runbook](../addon-registry/README.md).

Third-party OAuth, OS-keychain-backed addon secrets, wider schedule reads, paid-addon checkout/revenue sharing and unrestricted uploads are outside v1. Do not advertise them as available.
