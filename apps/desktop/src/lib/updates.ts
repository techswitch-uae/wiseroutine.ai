/**
 * Finding, downloading and installing a new version of the desktop app.
 *
 * Everything here is a no-op in a browser. The same frontend ships as the web
 * app, where there is nothing to update - the page reloads and it *is* the new
 * version - and where importing the plugin at all would drag Tauri's IPC into
 * a bundle that has no host to talk to. So the host is feature-detected the
 * same way `openExternal` does it, and the plugin is imported dynamically
 * behind that check rather than at the top of the file.
 */

/** What the UI needs to know about a pending version. The plugin's own object
 *  is carried along unopened, because only the plugin can act on it. */
export interface AppUpdate {
  version: string;
  notes?: string;
  /** The plugin's `Update`. Opaque on purpose - see `installUpdate`. */
  handle: {
    downloadAndInstall: (
      onEvent: (event: DownloadEvent) => void,
    ) => Promise<void>;
  };
}

/** The shape the updater plugin reports download progress in. */
export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

/**
 * Turn the plugin's download events into a percentage.
 *
 * Worth its own function because the events do not carry one. The total
 * arrives once, at the start; every later event carries only the size of the
 * chunk that just landed, so the running total has to be kept here. A server
 * that sends no `Content-Length` - which is allowed, and which a redirect to a
 * CDN can produce - leaves us unable to say how far along we are, so this
 * reports `null` rather than inventing a number that would stall at a lie.
 */
export function trackDownload(): (event: DownloadEvent) => number | null {
  let total = 0;
  let received = 0;

  return (event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      received = 0;
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
    } else {
      // Finished means finished, whatever the byte counts came to.
      return 100;
    }

    if (total <= 0) return null;
    // Clamped: a chunk total slightly over the advertised length is normal and
    // must not produce "downloading 103%".
    return Math.min(100, Math.round((received / total) * 100));
  };
}

/**
 * Ask whether there is a newer version.
 *
 * `null` covers every "nothing to do here" case - the web build, an app that
 * is already current, and an endpoint that could not be reached. A failed
 * check is deliberately not an error the user sees: they did not ask, and an
 * app that complains about its own update server on every launch is worse than
 * one that quietly tries again later.
 */
export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!inTauri()) return null;

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;

    return {
      version: update.version,
      ...(update.body ? { notes: update.body } : {}),
      handle: update,
    };
  } catch (error) {
    console.error("update check failed", error);
    return null;
  }
}

/**
 * Download, install, and restart into the new version.
 *
 * The relaunch is the point: an update that is installed but not running is
 * indistinguishable to the user from one that did nothing. It throws rather
 * than swallowing, because unlike the check, this one the user did ask for and
 * has to be told about.
 */
export async function installUpdate(
  update: AppUpdate,
  onPercent: (percent: number | null) => void,
): Promise<void> {
  const progress = trackDownload();
  await update.handle.downloadAndInstall((event) => onPercent(progress(event)));

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
