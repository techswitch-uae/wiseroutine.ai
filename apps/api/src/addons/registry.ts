import breathing from "@wiseroutine/addon-breathing/manifest";
import daySoFar from "@wiseroutine/addon-day-so-far/manifest";
import deepWork from "@wiseroutine/addon-deep-work/manifest";
import eyeRest from "@wiseroutine/addon-eye-rest/manifest";
import stretch from "@wiseroutine/addon-stretch/manifest";
import todos from "@wiseroutine/addon-todos/manifest";
import {
  type AddonManifest,
  isReservedId,
  parseManifest,
} from "@wiseroutine/addons";

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
  (entry.bundleHash.length === 64 && !isReservedId(entry.id));

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

  return listed.filter(isListable);
}

export const entryFor = (id: string): RegistryEntry | undefined =>
  registry().find((entry) => entry.id === id);

/** The ones that ship with the app, and so are switched rather than installed. */
export const bundledEntries = (): RegistryEntry[] =>
  registry().filter((entry) => entry.bundled && !entry.revoked);
