import {
  type AddonCapability,
  type AddonManifest,
  type ApprovalKeys,
  canonicalJSON,
  MAX_BUNDLE_BYTES,
  parseCapabilities,
  parseConfig,
  parseManifest,
  verifyRelease,
} from "@wiseroutine/addons";
import { useSyncExternalStore } from "react";
import trust from "../../../../addon-registry/trust.json" with { type: "json" };
import { api, type InstalledAddonRow } from "../lib/api";
import {
  accountStorageKey,
  onSessionReset,
  sessionGeneration,
  sessionIdentity,
} from "../lib/session-lifecycle";
import { addonStoragePrefix } from "./storage";

const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;
async function invoke<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args);
}
export interface InstalledAddon {
  manifest: AddonManifest;
  granted: readonly AddonCapability[];
  settings: Record<string, unknown>;
  author: string;
  bundled: boolean;
  bundle: string;
  revision?: string;
}
let addons: ReadonlyMap<string, InstalledAddon> = new Map();
let problems: ReadonlyMap<string, string> = new Map();
let sequence = 0;
let checkedAt = 0;
let nativeAccount: string | null = null;
let authorityQueue: Promise<unknown> = Promise.resolve();
function authorize(
  next: ReadonlyMap<string, InstalledAddon>,
  accountId: string | null,
): Promise<unknown> {
  if (!inTauri() || !accountId) return Promise.resolve();
  nativeAccount = accountId;
  const releases = [...next.values()]
    .filter((addon) => addon.revision)
    .map((addon) => ({ id: addon.manifest.id, revision: addon.revision }));
  authorityQueue = authorityQueue
    .catch(() => undefined)
    .then(() => invoke("authorize_addons", { accountId, releases }));
  return authorityQueue;
}
export function addonSafeMode(): boolean {
  try {
    return (
      localStorage.getItem(accountStorageKey("wr.addons.safe-mode")) === "true"
    );
  } catch {
    return false;
  }
}
export function setAddonSafeMode(enabled: boolean): void {
  localStorage.setItem(
    accountStorageKey("wr.addons.safe-mode"),
    String(enabled),
  );
  sequence++;
  publish(new Map());
  void authorize(new Map(), sessionIdentity()).catch(() => undefined);
  if (!enabled) void loadAddons();
}
export function addonAuthorized(addon: InstalledAddon): boolean {
  return (
    addons.get(addon.manifest.id) === addon &&
    !addonSafeMode() &&
    (addon.bundled || Date.now() - checkedAt < 5 * 60000)
  );
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(
  next: ReadonlyMap<string, InstalledAddon>,
  errors: ReadonlyMap<string, string> = new Map(),
): void {
  addons = next;
  problems = errors;
  for (const listener of listeners) listener();
}
onSessionReset(() => {
  sequence++;
  checkedAt = 0;
  publish(new Map());
  void authorize(new Map(), nativeAccount).catch(() => undefined);
});
export const installedAddons = (): ReadonlyMap<string, InstalledAddon> =>
  addons;
export const useInstalledAddons = () =>
  useSyncExternalStore(subscribe, installedAddons, installedAddons);
const problemSnapshot = () => problems;
export const useAddonProblems = () =>
  useSyncExternalStore(subscribe, problemSnapshot, problemSnapshot);

export async function forgetAddon(id: string): Promise<void> {
  const next = new Map(addons);
  next.delete(id);
  publish(next, problems); // Stop ports even if device cleanup later fails.
  const accountId = sessionIdentity();
  const prefix = addonStoragePrefix(id);
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {
    /* unavailable storage */
  }
  if (inTauri()) await invoke("forget_addon", { id, accountId });
}
export function frameUrlFor(id: string, revision?: string): string | null {
  if (!inTauri()) return null;
  const host = (
    globalThis as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (path: string, protocol: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  const account = sessionIdentity();
  // convertFileSrc encodes the entire file path (including slashes). Obtain
  // only its platform-specific origin, then append our separate URL segments.
  const base = host?.convertFileSrc?.("", "addon");
  return account && base
    ? `${base}${encodeURIComponent(account)}/${id}${revision ? `/${revision}` : ""}`
    : null;
}
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function boundedText(
  response: Response,
  maximum = MAX_BUNDLE_BYTES,
): Promise<string> {
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) throw new Error("Addon download exceeds size limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
const textAt = async (url: string, max = MAX_BUNDLE_BYTES) =>
  boundedText(
    await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error" }),
    max,
  );
async function installNative(
  addon: InstalledAddon,
  hash: string,
  accountId: string | null,
): Promise<void> {
  const manifest = JSON.stringify(addon.manifest),
    granted = JSON.stringify(addon.granted);
  addon.revision = await sha256Hex(`${manifest}\n${granted}\n${hash}`);
  if (inTauri()) {
    const revision = await invoke<string>("install_addon", {
      id: addon.manifest.id,
      accountId,
      manifest,
      granted,
      bundle: addon.bundle,
      hash,
    });
    if (revision !== addon.revision)
      throw new Error("Native release identity mismatch");
  }
}
function unchanged(
  old: InstalledAddon,
  row: InstalledAddonRow,
  manifest: AddonManifest,
): boolean {
  return (
    old.manifest.version === row.version &&
    canonicalJSON(old.manifest) === canonicalJSON(manifest) &&
    canonicalJSON(old.granted) === canonicalJSON(row.granted) &&
    canonicalJSON(old.settings) ===
      canonicalJSON(parseConfig(manifest, row.settings))
  );
}

/** Exact installed releases, never a lookup in the latest catalog by ID. */
export async function loadAddons(): Promise<void> {
  const generation = sessionGeneration(),
    request = ++sequence,
    accountId = sessionIdentity();
  if (addonSafeMode()) {
    publish(new Map());
    await authorize(new Map(), accountId);
    return;
  }
  let rows: InstalledAddonRow[];
  try {
    rows = (await api.installedAddons()).addons;
  } catch {
    if (
      generation === sessionGeneration() &&
      request === sequence &&
      Date.now() - checkedAt > 5 * 60000
    ) {
      const errors = new Map<string, string>();
      const next = new Map(
        [...addons].filter(([id, addon]) => {
          if (addon.bundled) return true;
          errors.set(
            id,
            "Approval could not be refreshed. Reconnect to run this addon.",
          );
          return false;
        }),
      );
      publish(next, errors);
      await authorize(next, accountId).catch(() => undefined);
    }
    return;
  }
  if (generation !== sessionGeneration() || request !== sequence) return;
  const retained = new Map(
    [...addons].filter(([id, old]) =>
      rows.some(
        (row) =>
          row.id === id &&
          row.isEnabled &&
          !row.revoked &&
          unchanged(old, row, parseManifest(row.manifest) ?? old.manifest),
      ),
    ),
  );
  publish(retained, problems);
  await authorize(retained, accountId).catch(() => undefined);
  const next = new Map<string, InstalledAddon>(),
    errors = new Map<string, string>();
  // Sequential and bounded: a catalog must not fan out unlimited downloads/native writes.
  for (const row of rows.slice(0, 32)) {
    if (generation !== sessionGeneration() || request !== sequence) return;
    if (!row.isEnabled || row.revoked) continue;
    try {
      const manifest = parseManifest(row.manifest);
      if (
        !manifest ||
        manifest.id !== row.id ||
        manifest.version !== row.version
      )
        throw new Error("Unsupported or mismatched addon manifest");
      if (!row.bundled) {
        if (
          !row.approval ||
          !(await verifyRelease(row.approval, trust as ApprovalKeys))
        )
          throw new Error("This release is not approved by a trusted key");
        const p = row.approval.payload;
        if (
          p.id !== row.id ||
          p.version !== row.version ||
          p.bundleHash !== row.bundleHash ||
          canonicalJSON(parseManifest(p.manifest)) !== canonicalJSON(manifest)
        )
          throw new Error("Installed release does not match its approval");
      }
      const old = addons.get(row.id);
      if (
        old &&
        unchanged(old, row, manifest) &&
        (row.bundled || row.bundleHash === (await sha256Hex(old.bundle)))
      ) {
        next.set(row.id, old);
        continue;
      }
      let bundle: string;
      if (row.bundled) {
        const local = parseManifest(
          JSON.parse(
            await textAt(`/addons/${row.id}/manifest.json`, 64 * 1024),
          ),
        );
        if (canonicalJSON(local) !== canonicalJSON(manifest))
          throw new Error("Update the desktop app to use this bundled release");
        bundle = await textAt(`/addons/${row.id}/addon.js`);
      } else {
        if (!row.bundleHash) throw new Error("Missing community bundle digest");
        bundle = await boundedText(await api.addonBundle(row.bundleHash));
      }
      const hash = await sha256Hex(bundle);
      if (!row.bundled && hash !== row.bundleHash)
        throw new Error("Addon bundle hash mismatch");
      const granted = parseCapabilities(row.granted);
      if (!granted) throw new Error("Invalid addon grant");
      const addon: InstalledAddon = {
        manifest,
        granted,
        settings: parseConfig(manifest, row.settings),
        author: row.approval?.payload.author ?? "Wise Routine",
        bundled: row.bundled,
        bundle,
      };
      if (generation !== sessionGeneration() || request !== sequence) return;
      await installNative(addon, hash, accountId);
      next.set(row.id, addon);
    } catch (error) {
      errors.set(
        row.id,
        error instanceof Error ? error.message : "Could not load addon",
      );
    }
  }
  if (generation === sessionGeneration() && request === sequence) {
    try {
      await authorize(next, accountId);
    } catch {
      next.clear();
      errors.set(
        "native",
        "Native addon approval failed. Restart the app or use safe mode.",
      );
    }
    if (generation === sessionGeneration() && request === sequence) {
      checkedAt = Date.now();
      publish(next, errors);
    }
  }
}
/** Approval lease: foreground/online checks plus a bounded periodic refresh. */
export function watchAddons(): () => void {
  const refresh = () => {
    void loadAddons();
  };
  refresh();
  const timer = setInterval(refresh, 30000);
  globalThis.addEventListener("focus", refresh);
  globalThis.addEventListener("online", refresh);
  return () => {
    sequence++;
    clearInterval(timer);
    globalThis.removeEventListener("focus", refresh);
    globalThis.removeEventListener("online", refresh);
  };
}
export function seedAddons(next: Iterable<InstalledAddon> = []): void {
  publish(new Map([...next].map((addon) => [addon.manifest.id, addon])));
}
