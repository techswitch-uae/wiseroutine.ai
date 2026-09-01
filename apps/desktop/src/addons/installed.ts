import { type AddonManifest, parseManifest } from "@wiseroutine/addons";
import { useSyncExternalStore } from "react";
import { type AvailableAddon, api, type InstalledAddonRow } from "../lib/api";

/** Whether there is a Tauri host to talk to. The same test `lib/alerts` uses. */
const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

/**
 * Put an addon where the custom protocol can serve it.
 *
 * Imported dynamically behind the host check, the same way `lib/alerts` does:
 * the web build has no Tauri, and importing its IPC would drag it into a
 * bundle with nothing to talk to.
 */
async function store(
  id: string,
  manifest: string,
  bundle: string,
): Promise<void> {
  if (!inTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("install_addon", { id, manifest, bundle });
}

/**
 * The URL the frame is served from, or null when there is no host to serve it.
 *
 * `convertFileSrc` rather than string concatenation because the URL differs by
 * platform - `addon://localhost/…` on macOS and Linux, `http://addon.localhost/…`
 * on Windows - and Tauri already knows which. It percent-encodes what it is
 * given, which is why the addon id is the whole path and contains no slash.
 */
export function frameUrlFor(id: string): string | null {
  if (!inTauri()) return null;
  const internals = (
    globalThis as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (path: string, protocol: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  return internals?.convertFileSrc?.(id, "addon") ?? null;
}

/**
 * The addons this app has installed, and their bundles.
 *
 * The same `useSyncExternalStore` shape as `lib/plan-store` and `lib/notify`,
 * because React ships it for exactly this and a store this small does not earn
 * a library.
 *
 * ## Where they come from
 *
 * An installed addon is a manifest and a bundle sitting at a URL the app can
 * fetch. Nothing here knows or cares how they got there: a downloaded addon
 * will be written to that path by the installer once its signature is checked;
 * a bundled one is put there by its own build. The loader is the same either
 * way, which is the point of loading the app's own breathing session through
 * it - a path only strangers' code takes is a path nobody tests.
 *
 * ## Why the manifest is fetched separately
 *
 * It has to be readable *without executing the addon*. A permission list
 * exported by the bundle would be a permission list written by the code it is
 * meant to constrain, and the user's approval would mean nothing.
 */

export interface InstalledAddon {
  manifest: AddonManifest;
  /** The built bundle, as text. Injected into the frame - see `frame.tsx`. */
  bundle: string;
}

let addons: ReadonlyMap<string, InstalledAddon> = new Map();
const listeners = new Set<() => void>();

const snapshot = (): ReadonlyMap<string, InstalledAddon> => addons;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: ReadonlyMap<string, InstalledAddon>): void {
  addons = next;
  for (const listen of listeners) listen();
}

/** Every installed addon, right now. For code that is not a component. */
export const installedAddons = snapshot;

export const useInstalledAddons = (): ReadonlyMap<string, InstalledAddon> =>
  useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Fetch one addon's manifest and bundle, and put it where the frame can serve
 * it from.
 *
 * `bundleUrl` comes from the server rather than being built here: an addon
 * bundled with the app is a relative path, and one from the registry is an
 * absolute URL, and the loader should not be the thing that knows which is
 * which.
 */
async function load(
  id: string,
  bundleUrl: string,
  manifest: AddonManifest,
): Promise<InstalledAddon | null> {
  try {
    const response = await fetch(bundleUrl);
    if (!response.ok) return null;
    const bundle = await response.text();

    /**
     * Hand it to Rust, which is what actually serves the frame.
     *
     * The frame has to be a *fetched* document rather than a `srcdoc` one, or
     * it inherits this app's Content-Security-Policy and its own script is
     * refused - see `src-tauri/src/addons.rs`. Rust cannot read what the
     * webview fetched, so the bytes are passed across.
     *
     * The manifest handed over is the one the *server* holds, which is the one
     * the user approved at install. Not a manifest fetched alongside the
     * bundle: those two could disagree, and the one that decides what an addon
     * may do should be the one somebody said yes to.
     *
     * A failure here is not fatal and must not be: the same frontend ships as
     * a web app, where there is no Tauri and no custom scheme, and it falls
     * back to `srcdoc` there - see `frame.tsx`.
     */
    await store(id, JSON.stringify(manifest), bundle).catch(() => undefined);

    return { manifest, bundle };
  } catch {
    // A missing or malformed addon is a missing addon, not a broken app. The
    // rail and the guided sessions already draw nothing for a key they do not
    // recognise, and this keeps that true when the reason is a failed fetch.
    return null;
  }
}

/**
 * Load every addon this user has installed and switched on.
 *
 * Called from the app shell, and again after anything is installed or removed.
 * Not idempotent any more, deliberately: it used to guard on a flag because
 * the list was a constant and could not change, and now it can.
 */
export async function loadAddons(): Promise<void> {
  let rows: InstalledAddonRow[];
  try {
    rows = (await api.installedAddons()).addons;
  } catch {
    // Offline, or not signed in yet. Leave whatever is already loaded rather
    // than emptying the rail because one request failed.
    return;
  }

  const available = await api
    .availableAddons()
    .then((response) => response.addons)
    .catch(() => [] as AvailableAddon[]);

  const loaded = await Promise.all(
    rows
      // Switched off is still installed. Revoked is withdrawn *after* it was
      // installed, and is the one case where the user's own choice is
      // overridden: an addon pulled from the registry stops running here.
      .filter((row) => row.isEnabled && !row.revoked)
      .map(async (row) => {
        const manifest = parseManifest(row.manifest);
        if (!manifest || manifest.id !== row.id) return null;

        const entry = available.find((candidate) => candidate.id === row.id);
        if (!entry) return null;

        return load(row.id, entry.bundleUrl, manifest);
      }),
  );

  const next = new Map<string, InstalledAddon>();
  for (const addon of loaded) {
    if (addon) next.set(addon.manifest.id, addon);
  }
  publish(next);
}

/** Test seam. Nothing in the app calls this. */
export function resetAddons(): void {
  publish(new Map());
}
