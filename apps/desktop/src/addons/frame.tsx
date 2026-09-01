import type { AddonManifest } from "@wiseroutine/addons";
import { useEffect, useRef, useState } from "react";
import { type AddonContext, serve } from "./host";
import { frameUrlFor } from "./installed";
import { addonTheme } from "./theme";

/**
 * An addon, running.
 *
 * One `<iframe>` with no `allow-same-origin`, which is the whole security
 * story and worth stating plainly rather than leaving to be inferred from an
 * attribute.
 *
 * `sandbox="allow-scripts"` alone gives the frame an **opaque origin**. It is
 * not the app's origin with some things switched off; it is a different origin
 * that matches nothing, including itself. From inside it:
 *
 * - `localStorage` throws, so the session token in `wiseroutine.session`
 *   cannot be read. That token is a thirty-day bearer for the whole API, and
 *   keeping it unreachable is the single thing this boundary exists for.
 * - `window.parent` is cross-origin, so the app's DOM and its React tree are
 *   unreachable.
 * - Tauri's IPC is unreachable. Capabilities in Tauri 2 are granted per origin
 *   (`remote.urls`) and every plugin command is denied by default, so an
 *   origin nothing names gets nothing. There is no capability file to forget
 *   to write - the default is already no.
 * - `fetch` reaches only what the CSP below allows, which is built from the
 *   addon's own manifest.
 *
 * `allow-same-origin` must never be added. With it, every line above stops
 * being true at once, and the frame becomes the app.
 *
 * ## Why srcdoc rather than a URL
 *
 * The document is written here, by the host, and the addon supplies only the
 * script inside it. That is what lets the CSP be a `<meta>` tag the host
 * controls: the addon cannot edit the document that constrains it, because it
 * does not exist until this component builds it. Serving the addon from a URL
 * would mean the CSP had to arrive as a response header, which means a Rust
 * custom protocol - more moving parts for a boundary that is already opaque.
 *
 * ponytail: no loader, no origin registry, no protocol handler. The platform
 * has a sandbox; this uses it.
 */

/**
 * The document an addon runs in.
 *
 * `default-src 'none'` and then only what an addon genuinely needs: its own
 * inline script, inline styles for what it draws, and images it inlines
 * itself. `connect-src` is the addon's declared origins and nothing else - so
 * an addon that has not asked for network access cannot make a request at all,
 * enforced by the browser rather than by a check it might route around.
 *
 * The script is inlined rather than linked because the frame has no origin to
 * resolve a relative URL against. `'unsafe-inline'` in `script-src` sounds
 * alarming and is not: the only script in this document is the one the host
 * just put there, and the frame has nothing worth stealing.
 */
function documentFor(manifest: AddonManifest, bundle: string): string {
  const origins = (kind: "net:fetch" | "ui:embed"): string =>
    manifest.capabilities
      .filter((c) => c.kind === kind)
      .flatMap((c) => ("origins" in c ? c.origins : []))
      .join(" ") || "'none'";

  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    `connect-src ${origins("net:fetch")}`,
    // What the addon may put in a frame of its own - a player, a map. A
    // separate list from `connect-src` because it is a separate risk: one is
    // data the addon reads, the other is somebody else's document drawing
    // pixels the user will read as part of the app.
    `frame-src ${origins("ui:embed")}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  // The bundle goes in a script element rather than through innerHTML, so
  // `</script>` inside a string literal cannot end the element early. Escaping
  // the one sequence that can is cheaper than a parser.
  const safe = bundle.replace(/<\/script/gi, "<\\/script");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
</head>
<body>
<script>${safe}</script>
</body>
</html>`;
}

export interface AddonFrameProps {
  manifest: AddonManifest;
  /** The addon's built bundle, as text. */
  bundle: string;
  /**
   * What this frame was loaded to do, answered when the addon asks. The host
   * decides; the addon is not asked to identify itself.
   */
  context: AddonContext;
  /** Sized by whatever is drawing it - a session takes the window, a widget
   *  takes the height it asked the host for. */
  style?: React.CSSProperties;
  title: string;
}

export const AddonFrame: React.FC<AddonFrameProps> = ({
  manifest,
  bundle,
  context,
  style,
  title,
}) => {
  const ref = useRef<HTMLIFrameElement>(null);

  /**
   * Served, or written here.
   *
   * The served one is the real answer and the one the packaged app uses: a
   * document *fetched* over the `addon:` scheme carries its own
   * Content-Security-Policy, built from the addon's manifest by
   * `src-tauri/src/addons.rs`.
   *
   * `srcdoc` is the fallback for the web build, which has no Tauri and so no
   * custom scheme. It is a genuine fallback and not merely a different route:
   * a `srcdoc` document *inherits* its parent's CSP, so this path only works
   * while the page framing it has no restrictive policy of its own. The web
   * build has none today. It must not gain one without gaining a way to serve
   * addon frames from somewhere else first - there is no fixing this from
   * inside the frame.
   */
  const served = frameUrlFor(manifest.id);
  const [html] = useState(() => documentFor(manifest, bundle));

  /**
   * The context as of this render, without the port depending on it.
   *
   * `context` is an object literal built by whoever draws this frame, so it is
   * a new object every render and an effect that depended on it re-ran every
   * render: teardown, new `MessageChannel`, new listener. After the frame had
   * loaded once, the `load` event that hands over the port never fires again -
   * so from the second render onwards the addon was holding a port nobody was
   * answering, and every call it made hung for ever.
   *
   * A session hid it, because a session's parent rarely re-renders while it is
   * open. A rail card would not have: it re-renders whenever the day does,
   * which is the moment it most needs its port.
   */
  const latest = useRef(context);
  latest.current = context;

  /**
   * Hand the addon its port once the document has loaded.
   *
   * A `MessageChannel`, transferred once, rather than letting the addon talk
   * to `window.parent` directly: possession of the port is the capability, so
   * nothing else on the page can speak to the host as this addon, and this
   * addon cannot speak to another. The handshake is the only message the
   * frame's own `window` ever receives.
   *
   * `"*"` as the target origin is correct here and only here: the frame's
   * origin is opaque, so there is no origin string that would match it. What
   * makes this safe is the reference - `frame.contentWindow` is this frame and
   * no other - not the origin check that cannot be written.
   */
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;

    const channel = new MessageChannel();
    const stop = serve(channel.port1, manifest, () => latest.current);

    /**
     * The port, and the two things that cannot change while it is open.
     *
     * `role` is why this frame exists and `theme` is what the app looks like.
     * Both are known here, before the addon's first line runs, and sending
     * them with the port is what spares every addon two round trips - and a
     * widget a first paint in the wrong colours.
     */
    const send = () => {
      const context = latest.current;
      frame.contentWindow?.postMessage(
        {
          type: "wiseroutine:addon:port",
          role:
            context.kind === "widget"
              ? { kind: "widget", widgetKey: context.widgetKey }
              : { kind: "session" },
          theme: addonTheme(),
        },
        "*",
        [channel.port2],
      );
    };

    frame.addEventListener("load", send);
    return () => {
      frame.removeEventListener("load", send);
      stop();
      channel.port1.close();
    };
  }, [manifest]);

  return (
    <iframe
      ref={ref}
      title={title}
      {...(served ? { src: served } : { srcDoc: html })}
      // Scripts, and nothing else. Not `allow-same-origin` - see the note at
      // the top of this file. Not `allow-popups`, `allow-modals`,
      // `allow-top-navigation` or `allow-forms`: an addon drawing inside a
      // session has no use for any of them, and each is a way to reach past
      // the frame at the user.
      sandbox="allow-scripts"
      style={{ border: 0, background: "transparent", ...style }}
    />
  );
};
