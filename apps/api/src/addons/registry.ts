import breathing from "@wiseroutine/addon-breathing/manifest";
import daySoFar from "@wiseroutine/addon-day-so-far/manifest";
import deepWork from "@wiseroutine/addon-deep-work/manifest";
import eyeRest from "@wiseroutine/addon-eye-rest/manifest";
import stretch from "@wiseroutine/addon-stretch/manifest";
import todos from "@wiseroutine/addon-todos/manifest";
import {
  type AddonManifest,
  type ApprovalKeys,
  type ApprovedRelease,
  isDigest,
  isReservedId,
  parseManifest,
  parseRelease,
  verifyRelease,
} from "@wiseroutine/addons";
import bundledHistory from "../../../../addon-registry/bundled-history.json" with {
  type: "json",
};
import catalog from "../../../../addon-registry/catalog.json" with {
  type: "json",
};
import trust from "../../../../addon-registry/trust.json" with { type: "json" };

/**
 * The addons this app will serve, and the only ones it will.
 *
 * Today the list is the six addons that ship inside the app. Their manifests
 * are imported from the addon packages so there is one copy of each
 * permission list. When community addons are published, entries for them are
 * added here with a versioned `bundleUrl` and a `bundleHash`; the desktop app
 * refuses a bundle that does not hash to it.
 *
 * The server owns the list so an addon can be revoked: pulled from the list
 * and stopped where it is already installed, without an app release.
 */

export interface RegistryEntry {
  id: string;
  version: string;
  approval?: ApprovedRelease;
  /** Where the bundle is. Relative for a bundled one. A community entry
   *  uses an absolute URL with the version in the path, so a published
   *  bundle never changes under its URL. */
  bundleUrl: string;
  /** sha256 hex of the bundle. Empty only for a bundled addon, whose bytes
   *  ship inside the signed app. Required for anything downloaded. */
  bundleHash: string;
  manifest: AddonManifest;
  /** Withdrawn after the fact. The app stops running it where it is
   *  already installed. */
  revoked?: boolean;
  /** Shown on the addon's card. Who to blame, and who to thank. */
  author: string;
  /**
   * Ships inside the app. The user sees a switch instead of Install and
   * Remove. Everything else is the same as a community addon: permissions,
   * sandbox, checks.
   */
  bundled?: boolean;
}

/**
 * The app's own six. Every guided session and every first-party card is an
 * addon, so the path a community addon takes is the path the app depends on.
 */
const BUNDLED: readonly unknown[] = [
  breathing,
  eyeRest,
  stretch,
  deepWork,
  daySoFar,
  todos,
];

/**
 * May this entry be listed? A bundled addon needs no hash. Anything else
 * needs one, and may not use the app's own id prefix.
 */
export const isListable = (entry: RegistryEntry): boolean =>
  entry.bundled === true ||
  (isDigest(entry.bundleHash) && !isReservedId(entry.id));

/** Every entry, parsed the same way the client parses it. */
export function registry(): RegistryEntry[] {
  const listed: RegistryEntry[] = [];

  for (const raw of BUNDLED) {
    const manifest = parseManifest(raw);
    if (!manifest) continue;
    listed.push({
      id: manifest.id,
      version: manifest.version,
      // Derived from the id, so the URL and the store never disagree.
      bundleUrl: `/addons/${manifest.id}/addon.js`,
      bundleHash: "",
      author: "Wise Routine",
      bundled: true,
      manifest,
    });
  }

  for (const [id, version] of Object.entries(catalog.current)) {
    const entry = communityRelease(id, String(version));
    if (entry) listed.push(entry);
  }
  return listed.filter(isListable);
}

export const entryFor = (id: string): RegistryEntry | undefined =>
  registry().find((entry) => entry.id === id);

function communityRelease(
  id: string,
  version: string,
): RegistryEntry | undefined {
  const release = (catalog.releases as unknown[])
    .map(parseRelease)
    .find(
      (entry) => entry?.payload.id === id && entry.payload.version === version,
    );
  if (!release) return undefined;
  const p = release.payload;
  const manifest = parseManifest(p.manifest);
  if (!manifest) return undefined;
  return {
    id,
    version,
    manifest,
    author: p.author,
    bundleHash: p.bundleHash,
    bundleUrl: `/addons/bundles/${p.bundleHash}`,
    approval: release,
    revoked:
      (catalog.revoked as string[]).includes(id) ||
      (catalog.revoked as string[]).includes(`${id}@${version}`),
  };
}
export function releaseFor(
  id: string,
  version: string,
): RegistryEntry | undefined {
  const builtin = registry().find(
    (entry) => entry.bundled && entry.id === id && entry.version === version,
  );
  if (builtin) return builtin;
  const archived = bundledHistory
    .map(parseManifest)
    .find((manifest) => manifest?.id === id && manifest.version === version);
  if (archived && BUNDLED.some((raw) => parseManifest(raw)?.id === id))
    return {
      id,
      version,
      manifest: archived,
      bundled: true,
      bundleHash: "",
      bundleUrl: `/addons/${id}/addon.js`,
      author: "Wise Routine",
    };
  return communityRelease(id, version);
}
const approvals = new Map<string, Promise<boolean>>();
export function isApproved(entry: RegistryEntry | undefined): Promise<boolean> {
  if (
    !entry ||
    entry.revoked ||
    (catalog.revoked as string[]).includes(entry.id) ||
    (catalog.revoked as string[]).includes(`${entry.id}@${entry.version}`)
  )
    return Promise.resolve(false);
  if (entry.bundled) return Promise.resolve(true);
  const key = JSON.stringify(entry.approval);
  let result = approvals.get(key);
  if (!result) {
    result = verifyRelease(entry.approval, trust as ApprovalKeys);
    approvals.set(key, result);
  }
  return result;
}
export function releaseWithHash(hash: string): RegistryEntry | undefined {
  for (const raw of catalog.releases as unknown[]) {
    const release = parseRelease(raw);
    if (release?.payload.bundleHash === hash)
      return communityRelease(release.payload.id, release.payload.version);
  }
  return undefined;
}

/** The ones that ship with the app, and so are switched rather than installed. */
export const bundledEntries = (): RegistryEntry[] =>
  registry().filter((entry) => entry.bundled && !entry.revoked);
