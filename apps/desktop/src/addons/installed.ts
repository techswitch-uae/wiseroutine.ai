import {
  type AddonCapability,
  type AddonManifest,
  parseCapabilities,
  parseConfig,
  parseManifest,
} from "@wiseroutine/addons";
import { useSyncExternalStore } from "react";
import { type AvailableAddon, api, type InstalledAddonRow } from "../lib/api";

/** Whether there is a Tauri host to talk to. */
const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

async function invoke<T>(command: string, args: unknown): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args as Record<string, unknown>);
}

/**
 * Hand an addon to Rust, which serves the frame. Rust checks the hash again
 * and refuses a bundle that does not match. Web build: nothing to hand to.
 */
async function store(addon: InstalledAddon, hash: string): Promise<void> {
  if (!inTauri()) return;
  await invoke("install_addon", {
    id: addon.manifest.id,
    manifest: JSON.stringify(addon.manifest),
    granted: JSON.stringify(addon.granted),
    bundle: addon.bundle,
    hash,
  });
}

/** Take everything the device holds for an addon: bundle, secrets, store. */
export async function forgetAddon(id: string): Promise<void> {
  const prefix = `wr.addon.${id}.`;
  try {
    const keys = Object.keys(globalThis.localStorage ?? {});
    for (const key of keys) {
      if (key.startsWith(prefix)) globalThis.localStorage.removeItem(key);
    }
  } catch {
    // No storage. Nothing to forget.
  }
  if (inTauri()) await invoke("forget_addon", { id }).catch(() => undefined);
}

/**
 * The URL the frame is served from, or null when there is no host to serve
 * it. Built with Tauri's own `convertFileSrc` because it differs by platform.
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
 * An installed addon, loaded.
 *
 * `granted` is what the user approved, and is what the host checks. It can
 * be narrower than `manifest.capabilities`.
 */
export interface InstalledAddon {
  manifest: AddonManifest;
  granted: readonly AddonCapability[];
  /** Addon-level settings, parsed against the manifest. Never secrets. */
  settings: Record<string, unknown>;
  author: string;
  bundled: boolean;
  /** The built bundle, as text. */
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

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fetch one addon's bundle, check it, and hand it to the device.
 *
 * The manifest and grant are the server's, which is what the user approved.
 * A bundle that does not hash to what the registry published is dropped:
 * the addon is then simply not loaded.
 */
async function load(
  row: InstalledAddonRow,
  entry: { bundleUrl: string; bundleHash: string; author: string },
  manifest: AddonManifest,
): Promise<InstalledAddon | null> {
  try {
    const response = await fetch(entry.bundleUrl);
    if (!response.ok) return null;
    const bundle = await response.text();

    if (entry.bundleHash && (await sha256Hex(bundle)) !== entry.bundleHash) {
      return null;
    }

    const granted = parseCapabilities(row.granted) ?? [];
    const addon: InstalledAddon = {
      manifest,
      granted,
      settings: parseConfig(manifest, row.settings),
      author: entry.author,
      bundled: row.bundled,
      bundle,
    };
    await store(addon, entry.bundleHash);
    return addon;
  } catch {
    // A missing or refused addon is a missing addon, not a broken app.
    return null;
  }
}

/**
 * A local addon during development.
 *
 * Set `VITE_ADDON_SIDELOAD` to a URL that serves `manifest.json` and
 * `addon.js`. It is loaded with everything it asks for, on top of what is
 * installed. Development builds only.
 */
async function sideload(): Promise<InstalledAddon | null> {
  const base = import.meta.env.DEV
    ? (import.meta.env.VITE_ADDON_SIDELOAD as string | undefined)
    : undefined;
  if (!base) return null;
  try {
    const url = base.replace(/\/$/, "");
    const manifest = parseManifest(
      await fetch(`${url}/manifest.json`).then((r) => r.json()),
    );
    if (!manifest) return null;
    const bundle = await fetch(`${url}/addon.js`).then((r) => r.text());
    const addon: InstalledAddon = {
      manifest,
      granted: manifest.capabilities,
      settings: parseConfig(manifest, {}),
      author: "Sideloaded",
      bundled: false,
      bundle,
    };
    await store(addon, "").catch(() => undefined);
    return addon;
  } catch {
    return null;
  }
}

/**
 * Load every addon this user has installed and switched on. Called from the
 * app shell, and again after anything is installed, changed or removed.
 */
export async function loadAddons(): Promise<void> {
  let rows: InstalledAddonRow[];
  try {
    rows = (await api.installedAddons()).addons;
  } catch {
    // Offline, or not signed in yet. Keep what is already loaded.
    return;
  }

  const available = await api
    .availableAddons()
    .then((response) => response.addons)
    .catch(() => [] as AvailableAddon[]);

  const loaded = await Promise.all(
    rows
      // Off is still installed but not loaded. Revoked stops running here.
      .filter((row) => row.isEnabled && !row.revoked)
      .map(async (row) => {
        const manifest = parseManifest(row.manifest);
        if (!manifest || manifest.id !== row.id) return null;

        const entry = available.find((candidate) => candidate.id === row.id);
        if (!entry) return null;

        return load(row, entry, manifest);
      }),
  );

  const next = new Map<string, InstalledAddon>();
  for (const addon of [...loaded, await sideload()]) {
    if (addon) next.set(addon.manifest.id, addon);
  }
  publish(next);
}

/**
 * Test seam. Puts addons straight into the store without a fetch, a Rust
 * command or a frame. Called with nothing, it empties the store.
 */
export function seedAddons(next: Iterable<InstalledAddon> = []): void {
  const map = new Map<string, InstalledAddon>();
  for (const addon of next) map.set(addon.manifest.id, addon);
  publish(map);
}
