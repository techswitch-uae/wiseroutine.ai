# Addons

An addon is a package that adds to Wise Routine: a card in the rail, a guided
session (an activity type), a row in Quick add, or all three. Every session
and card the app ships is an addon, so the path a community addon takes is
the path the app runs on every day.

This page says what an addon can do today, how the boundary works, and how
to write one.

## What an addon can do

| Contribution | Manifest field | What the user sees |
| --- | --- | --- |
| Card in the rail | `widgets` | A card with the app's own frame. The addon draws the inside and sets the eyebrow and height. |
| Activity type | `activityTypes` | A guided session the user can add as an activity. Its settings are drawn by the app in the activity form. |
| Quick add row | `quickAdd` | A "keep it" row in ⌘K. The addon receives the text and answers with a sentence. |
| Own settings | `settings` | A form on the Addons page. Values reach the addon through `wr.settings()`. Secret fields never do. |

What an addon can ask for, and what each grants:

| Capability | Grants |
| --- | --- |
| `read:schedule` (scope `today`) | `wr.day()`: today's slots, with `ownedByYou` per slot. Only `today` can be granted for now. |
| `write:own` | `wr.placeSlot()` and `wr.setSlotStatus()` on slots the addon placed. The server refuses any other slot. |
| `read:todos`, `write:todos` | `wr.todos.*`. |
| `ui:widget` | A card, and `wr.card()`. |
| `ui:session` | An activity type, `wr.session()` and `wr.finishSession()`. |
| `net:fetch` (origins, optional `auth`) | `fetch` from the frame to those origins, and `wr.fetch()` through the host. With `auth`, the host adds a header from a secret the user entered. |
| `ui:embed` (origins) | Those origins in an `<iframe>` inside the addon's frame. |
| `open:external` (origins) | `wr.openExternal()` for https links on those origins. |
| `notify` | `wr.notify()`. Labelled with the addon's name, at most one every ten seconds. |
| `background:wake` | A hidden frame kept running while the app is open. Addons with a `quickAdd` row get one without asking. |

Always available: `wr.store` (16 KB per key, on this device, cleared on
remove), `wr.theme`, `wr.role`, `wr.hostVersion`, `wr.onDayChange`,
`wr.onTodosChange`, `wr.onQuickAdd`.

## What an addon cannot do

- Read or change the user's own activities and slots. There is no capability
  for it.
- Read the schedule beyond today. The scopes `week`, `range` and `history`
  exist in the vocabulary and are refused at install.
- Draw its own settings form, the Done button, or anything outside its frame.
- Reach any origin it was not granted. The frame's Content-Security-Policy and
  the host both refuse.
- See a secret. Secrets go from the Addons page to Rust and are used only by
  the fetch proxy.
- Use `wr.fetch()` in the web build. There is no Rust to fetch through. Plain
  `fetch` still works there, within the granted origins.
- Create activities. `write:own` covers slots only.

## How the boundary works

**The frame.** An addon runs in an `<iframe sandbox="allow-scripts">`. That
gives it an opaque origin: no storage, no reach into the app, no Tauri IPC,
and `Origin: null` on requests. The document is fetched over the `addon:`
scheme in the desktop app, so it carries its own Content-Security-Policy built
from the grant. The web build falls back to `srcdoc` with a `<meta>` policy.

**The port.** At load the host transfers one `MessagePort`. Everything the
addon does goes through it as a JSON call. Holding the port is the capability.

**The grant.** What the user approved is stored as `granted_json`, separate
from the manifest. The desktop host checks every call against the grant. Every
write the host proxies carries the addon's id in an `x-wr-addon` header, and
the Worker checks the grant again, plus ownership for slots. The Worker's
check is the gate.

**Upgrades.** A new version keeps the grant it had. Anything extra it asks for
is listed on the Addons page with an Allow button and stays off until pressed.
A user may also grant less than the manifest asks for.

**Bundles.** The registry lists each addon with a version, a bundle URL and a
sha256. The desktop app refuses a bundle that does not hash to it, in
JavaScript before install and in Rust on install and on every serve. Bundled
addons ship inside the signed app and carry no hash. Community entries need
one, and the `wiseroutine.` id prefix is reserved.

**Revocation.** The server owns the registry. An addon marked revoked stops
being installable and stops running where it is installed, on the next load.

## Writing one

A manifest beside a single IIFE bundle. See `addons/todos` for a card with a
Quick add row and `addons/breathing` for a session.

```jsonc
// manifest.json
{
  "$schema": "https://wiseroutine.ai/schemas/addon-manifest.json",
  "id": "acme.workouts",
  "apiVersion": 1,
  "name": "Acme Workouts",
  "version": "1.0.0",
  "description": "Your next workout, from Acme.",
  "capabilities": [
    { "kind": "ui:widget" },
    { "kind": "read:schedule", "scope": "today" },
    { "kind": "write:own" },
    {
      "kind": "net:fetch",
      "origins": ["https://api.acme.example"],
      "auth": { "secret": "apiKey", "header": "Authorization", "prefix": "Bearer " }
    }
  ],
  "settings": [
    { "key": "apiKey", "label": "Acme API key", "type": "secret" },
    { "key": "units", "label": "Units", "type": "select", "default": "km", "options": ["km", "mi"] }
  ],
  "widgets": [{ "key": "next", "name": "Next workout" }]
}
```

```ts
// src/main.ts
import { connect } from "@wiseroutine/addon-sdk";

const wr = await connect();
if (wr.role.kind === "widget") {
  const { units } = await wr.settings<{ units: string }>();
  const next = await wr.fetch("https://api.acme.example/next").then((r) => r.json());
  document.body.textContent = `${next.name} · ${next.distance} ${units}`;
  await wr.card({ eyebrow: "Next workout", height: 64 });
}
```

Settings fields: `select`, `number`, `text`, `boolean`, and `secret` (addon
level only). Each takes `help` and `showWhen: { key, equals }`. The JSON Schema
is at `packages/addons/manifest.schema.json`.

Build with Vite as the bundled addons do: `formats: ["iife"]`, one
`addon.js`, manifest copied beside it. The frame cannot load a second file.

### Running a local addon

Set `VITE_ADDON_SIDELOAD` to a URL that serves `manifest.json` and `addon.js`,
then run `pnpm dev`. The addon is loaded with everything it asks for.
Development builds only.

```bash
VITE_ADDON_SIDELOAD=http://localhost:4173 pnpm dev
```

### Publishing

`@wiseroutine/addon-sdk` and `@wiseroutine/addons` (types, parser, JSON
Schema) build to `dist/` with `pnpm build` and are set up to publish. The
registry is the list in `apps/api/src/addons/registry.ts`. A community entry
needs a versioned `bundleUrl` and a `bundleHash`.

## Not yet

- Signed bundles. Hashes are checked; a signature over the hash with a
  release key is the next step once CI publishes.
- Secrets in the OS keychain. Today they are a file with owner-only
  permissions in the app data directory.
- OAuth for third-party services. `open:external` plus a callback.
- Reading beyond today.
- Addons creating activities, not only slots.
- Ordering addon cards in the rail.
