import { type AddonCapability, API_VERSION } from "@wiseroutine/addons";
import { useEffect, useRef, useState } from "react";
import { type AddonContext, serve } from "./host";
import { addonAuthorized, frameUrlFor, type InstalledAddon } from "./installed";
import { addonTheme } from "./theme";

/**
 * An addon, running.
 *
 * One `<iframe sandbox="allow-scripts">`. Without `allow-same-origin` the
 * frame has an opaque origin: no storage (so no session token), no reach into
 * the app's DOM, no Tauri IPC, and `fetch` limited by the CSP below. That
 * attribute must never be added.
 *
 * In the packaged app the document is fetched over the `addon:` scheme and
 * carries its own CSP, built by `src-tauri/src/addons.rs`. The web build has
 * no Tauri, so it falls back to `srcdoc` with a `<meta>` CSP. A `srcdoc`
 * document also inherits its parent's CSP, so the web build must not gain a
 * restrictive one without another way to serve frames.
 */

/** The `<meta>` CSP for the srcdoc fallback, from the grant. */
function documentFor(
  granted: readonly AddonCapability[],
  bundle: string,
): string {
  const origins = (kind: "net:fetch" | "ui:embed"): string =>
    granted
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
    `frame-src ${origins("ui:embed")}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  // `</script` inside the bundle would end the element early.
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
  addon: InstalledAddon;
  /** What this frame was loaded to do. The host decides. */
  context: AddonContext;
  style?: React.CSSProperties;
  title: string;
}

export const AddonFrame: React.FC<AddonFrameProps> = (props) => (
  <FrameInstance
    key={JSON.stringify([
      props.addon.revision ?? props.addon.bundle,
      props.addon.manifest,
      props.addon.granted,
      props.addon.settings,
      props.context.kind,
      props.context.kind === "widget"
        ? props.context.widgetKey
        : props.context.kind === "session"
          ? [
              props.context.activityTypeKey,
              (props.context.slot as { id?: string })?.id,
            ]
          : null,
    ])}
    {...props}
  />
);

const FrameInstance: React.FC<AddonFrameProps> = ({
  addon,
  context,
  style,
  title,
}) => {
  const [frameAddon] = useState(addon);
  const ref = useRef<HTMLIFrameElement>(null);
  const served = frameUrlFor(addon.manifest.id, addon.revision);
  const [html] = useState(() => documentFor(addon.granted, addon.bundle));

  // Read per request, not captured: the context is a new object every
  // render, and rebuilding the port after load would hand the addon a port
  // nobody answers.
  const latest = useRef(context);
  latest.current = context;

  /**
   * Hand the addon its port once the document has loaded. A transferred
   * `MessageChannel`, so nothing else on the page can speak as this addon.
   * `"*"` is the only target origin that matches an opaque one; what makes
   * it safe is that `frame.contentWindow` is this frame and no other.
   */
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;

    const channel = new MessageChannel();
    const stop = serve(
      channel.port1,
      frameAddon,
      () => latest.current,
      () => addonAuthorized(frameAddon),
    );

    const send = () => {
      const context = latest.current;
      frame.contentWindow?.postMessage(
        {
          type: "wiseroutine:addon:port",
          role:
            context.kind === "widget"
              ? { kind: "widget", widgetKey: context.widgetKey }
              : context.kind === "session"
                ? { kind: "session", activityTypeKey: context.activityTypeKey }
                : { kind: context.kind },
          theme: addonTheme(),
          hostVersion: API_VERSION,
          apiVersion: API_VERSION,
        },
        "*",
        [channel.port2],
      );
    };

    frame.addEventListener("load", send, { once: true });
    return () => {
      frame.removeEventListener("load", send);
      stop();
      channel.port1.close();
    };
  }, [frameAddon]);

  return (
    <iframe
      ref={ref}
      title={title}
      {...(served ? { src: served } : { srcDoc: html })}
      // Scripts and nothing else. No popups, modals, forms or navigation.
      sandbox="allow-scripts"
      // No camera, microphone, location, clipboard or payment, said outright.
      allow=""
      referrerPolicy="no-referrer"
      style={{ border: 0, background: "transparent", ...style }}
    />
  );
};
