/**
 * Open a URL in the user's real browser, and say whether it worked.
 *
 * Two environments, one job. In the packaged app this is Tauri's opener
 * plugin: the app's own webview must not navigate to a consent screen - it
 * would replace the app - and providers refuse to render one in an embedded
 * webview anyway. In a plain browser it is `window.open`, which the popup
 * blocker may refuse, because by the time we have a URL to open the click that
 * authorised it has already been spent on a round trip to the server.
 *
 * The boolean is the point. A blocked popup that is reported as success leaves
 * the user watching a spinner wait for a consent screen nobody ever showed
 * them - which is exactly what this function was written to stop.
 *
 * Tauri also has an opinion about the scheme. `opener:default` allows only
 * `http`, `https`, `mailto` and `tel`; anything else comes back as a
 * `ForbiddenUrl` and lands in the `catch` below, which is why the link to
 * macOS notification settings did nothing at all. The extra schemes this app
 * opens - `x-apple.systempreferences`, and the native music links deep work
 * accepts - are listed in `src-tauri/capabilities/default.json`. A new scheme
 * has to be added there or it will fail the same silent way.
 */
export async function openExternal(url: string): Promise<boolean> {
  // Feature-detect the host rather than catching a failure: outside Tauri the
  // plugin's IPC throws, and "it threw" is a poor way to ask where we are.
  if ("__TAURI_INTERNALS__" in globalThis) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return true;
    } catch (error) {
      console.error("opener refused", error);
      return false;
    }
  }

  try {
    // `noopener` so the consent page gets no handle back to the app.
    return globalThis.open(url, "_blank", "noopener") !== null;
  } catch {
    return false;
  }
}
