# @wiseroutine/addon-sdk

The MIT-licensed client for Wise Routine's sandboxed addon API (API version 1). It has no runtime dependency on the private app or backend.

```ts
import { connect } from "@wiseroutine/addon-sdk";

const wr = await connect();
if (wr.role.kind === "widget") {
  await wr.card({ eyebrow: "Hello", height: 160 });
  document.body.textContent = "A small pause in your day.";
}
if (wr.role.kind === "session") {
  const session = await wr.session();
  console.log(session.activityTypeKey, session.slot, session.config);
  // Call wr.finishSession() when the user finishes this assigned session.
}
```

Build a single self-contained IIFE as `dist/addon.js`. See the standalone addon kit's `README.md`, `SPEC.md` and six examples; `@wiseroutine/addon-tools` provides `wr-addon init`, `validate`, `preview` and `package`.

`connect()` requires the **parent host's** MessagePort handshake; opening an addon bundle directly is not a development host. Handshake timeout: 10 seconds by default. RPC deadline: 35 seconds; at most 64 SDK calls may be pending. `dispose()` rejects outstanding calls and closes the port; pagehide also disposes. A timeout/abort does not undo a write already accepted by the server.

Methods include `session`, `finishSession`, `settings`, `day`, `card`, `placeSlot`, `setSlotStatus`, `store`, `notify`, `fetch`, `openExternal`, `todos`, and change/Quick Add listeners. The declarations are the complete typed API. Handle `AddonError`; denied permissions are normal, not something to retry in a loop.

`day()` returns today's activity/task slots, not calendar events. `write:todos` permits changes to the user's todo list, not only records created by your addon. The host's session completion only completes the assigned session. Multiple activity types are distinguished by `activityTypeKey` (optional for compatibility with older API-1 hosts).

`fetch` is a host proxy, **not browser fetch**: absolute approved HTTPS origins, method, string headers and optional UTF-8 string body; no cookie jar, redirects, binary uploads, streaming response or arbitrary RequestInit semantics. AbortSignal stops waiting locally. 204/205/304 responses have no body. Network/secret integrations are outside the initial community preview, even though the full SDK describes them.

The SDK license permits commercial use, modification and redistribution with the license notice. It does **not** grant a Wise Routine account, Pro subscription, production API access, approval for distribution, support commitment or rights to Wise Routine trademarks. The app and hosted service have separate terms. Publishing an addon does not make the main application open source.
