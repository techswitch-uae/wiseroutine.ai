# Addon contract — API 1, curated preview

This specification accompanies `@wiseroutine/addon-sdk`, `@wiseroutine/addons` and `@wiseroutine/addon-tools` 0.1.0. API version, SDK package version and an addon's own release version are independent. `wr-addon validate` runs JSON Schema **and** semantic checks. Types describe the wire; they are not permission grants.

## Package

`manifest.json` plus a single self-contained UTF-8 IIFE at `dist/addon.js`; maximum 64 KiB manifest / 2 MiB code. Bundle all dependencies; no Node, filesystem, shell or Tauri API. Include lockfile, tests, license text, source commit and support/privacy metadata in the submission. Do not embed credentials or private user data. No remote executable dependencies.

Required manifest fields: `id`, `name`, `version`, `description`, `capabilities`. `apiVersion` defaults to 1; unsupported versions are refused. Versions: `major.minor.patch` with optional prerelease suffix; no mutable `latest`. IDs/keys: lowercase alphanumeric groups separated by dot/hyphen, at most 64 characters. `wiseroutine` and `wiseroutine.*` are reserved. An approved ID/version is immutable, including its manifest, code, source, license and digest.

Optional `widgets`, `activityTypes`, `quickAdd` arrays hold at most four contributions each. Keys are unique within each kind and qualified by the host as `addonId/key`. Widgets require `ui:widget`; activity types require `ui:session`. An activity type declares `key`, `name`, `blurb`, `defaults` (`sessionMinutes` 1–240; `startPolicy` manual/auto/prompt), optional canvas/ground and settings. Canvas values must be finite; the host clamps width to 200–560 and height to 120–520.

Settings: at most twenty fields per schema, unique safe keys, `select`, `number`, `text`, `boolean`, or addon-level `secret`. Secrets are never activity settings or returned by `settings()`. Prototype keys are refused. `showWhen` is presentation, not an authorization rule. Defaults and ranges must agree. Number bounds must be finite; text maxLength is 1–4096 when supplied. Generic editor schemas cannot enforce every semantic rule; the parser and CLI remain required.

## Launch permission subset

| Capability | What it means |
| --- | --- |
| `ui:widget` | Present a card for the selected widget contribution |
| `ui:session` | Draw inside, read context for, and finish the assigned session |
| `read:schedule`, scope `today` | Today's activity/task slot titles, times and states; **not calendar events** |
| `read:todos` | Read the user's todo list |
| `write:todos` | Create/change/drop/place any user todo, not just addon-created items |
| `write:own` | Place and complete/skip addon-owned slots, not arbitrary user activities |
| `notify` | A host-labelled notification, rate-limited |

The full contract additionally describes `net:fetch`, `ui:embed`, `open:external`, `background:wake` and addon-level secret fields. They are **not accepted for initial community distribution**. First-party examples can exercise a broader contract. Quick Add may use a hidden frame without background wake permission; this is not a system service or an always-running job.

Permissions limit host authority, not a proof of benign behavior. Even read-only access reveals data to the addon code. Read access combined with network authority can transmit that data; credential injection can authorize destructive requests or remote reflection. Review must assess combinations, not just individual permission names. Iframes are not dependable CPU/memory/process budgets.

## Connection and messages

An opaque-origin iframe has `sandbox="allow-scripts"` only. Never request or add `allow-same-origin`, top navigation, forms or popups. Parent sends one `wiseroutine:addon:port` handshake containing role, theme, API/host versions and a MessagePort. The SDK accepts it only from `window.parent`; subsequent RPC uses only the port.

Roles: `{kind:"widget", widgetKey}`, `{kind:"session", activityTypeKey?}`, `{kind:"background"}`. Session context includes assigned slot, parsed activity config and `activityTypeKey`; older API-1 hosts can omit the key. `finishSession` concerns only that assigned session. The host owns session timing and Done/Stop controls.

Requests: `{id: safeInteger, method: string, params?: JSON}`. Replies: `{id, result?}` or `{id, error:{kind:"denied"|"failed", message}}`. Events: `day`, `todos`, and `quickAdd` with a request ID and contribution key/title/minutes; Quick Add responds with `quickAdd:done`. Subscribe using the SDK rather than inventing another channel. See SDK declarations for all value shapes.

Host budgets: 60 calls/second and 8 concurrent calls per frame, 64 KiB serialized parameter envelope. SDK: 10-second default connect timeout, 35-second RPC timeout, 64 pending calls. An abort/timeout stops waiting; it does not roll back a server write. Do not retry non-idempotent writes blindly. Revocation closes authority; disposal rejects outstanding SDK calls. No unbounded polling.

Store: JSON values scoped to verified account and addon, 64 keys, 16 KiB UTF-8 per value, 256 KiB values total. Keys allow letters/digits/dot/underscore/hyphen, maximum 64. `set(key, undefined)` removes a value. Device storage can be unavailable/full; handle failure. Store is not a credential vault. Legacy ambiguous keys are not automatically reassigned.

Full-contract `fetch` accepts an absolute approved HTTPS URL, method, string headers and optional UTF-8 string body. It is not full browser fetch/RequestInit. No redirects, cookie jar, binary uploads or streaming reply; native response limit 5 MiB, timeout 30 seconds. Bodyless statuses 204/205/304 return null bodies. Authorization changes compare origin, secret field, case-insensitive header and prefix; they require new consent.

## Releases, updates and revocation

A community release is an `ApprovedRelease`: signed payload `{format:1,id,version,manifest,bundleHash,author,license,source:{repository,commit}}`, `keyId`, and base64 signature. Canonical JSON sorts object keys recursively and preserves array order, with JSON primitives only. ECDSA P-256/SHA-256 uses raw 64-byte IEEE-P1363 signatures. Trust keys are supplied by the app, never the descriptor. Digests are lowercase SHA-256 hex of exact UTF-8 bundle bytes.

The server supplies the **installed** release, not the latest entry sharing an ID. The client checks signature, manifest, version and digest together. Bundled releases must match the local manifest; old app/server mismatches fail closed with an update message. Approved old versions remain available for explicit rollback. Reads do not upgrade installations. Upgrade/rollback is explicit; running activity sessions block version changes. Removed permissions are dropped, and changed/new ones require approval.

Frames are keyed by release/grant/settings identity. Ordinary registry refreshes preserve connections; changed identities deliberately remount. Native snapshots are staged, verified and renamed atomically, then activated by their revision-specific frame URL. Missing/mismatched hash or metadata refuses execution.

Online approval refresh runs on startup/focus/online and every 30 seconds. Community cached host authority expires after five minutes without verification. Native authority also expires after five minutes, using a monotonic clock. Unknown or withdrawn releases fail closed on backend calls. Safe mode stops local addon frames without removing account activities. No guarantee of immediate remote recall, cancellation of accepted writes, or persistent offline community execution. A suspended webview is not a background scheduler.

## Service boundary

Addons never receive session/billing/provider tokens. The server enforces grants, ownership, approved release and account plan. No SDK method creates arbitrary app routes, replaces the scheduler, registers a calendar provider, obtains third-party OAuth, creates app activities or bypasses Free/Pro limits. An open-source license grants code rights, not a service subscription or review approval.
