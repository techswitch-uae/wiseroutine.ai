import breathing from "@wiseroutine/addon-breathing/manifest";
import daySoFar from "@wiseroutine/addon-day-so-far/manifest";
import deepWork from "@wiseroutine/addon-deep-work/manifest";
import eyeRest from "@wiseroutine/addon-eye-rest/manifest";
import stretch from "@wiseroutine/addon-stretch/manifest";
import { type AddonManifest, parseManifest } from "@wiseroutine/addons";

/**
 * The addons this app will serve, and the only ones it will.
 *
 * ## How something gets on this list
 *
 * A contributor opens a pull request against the addons repository with their
 * source. It is reviewed as source - which is the point of doing it this way
 * rather than through an upload form, where the thing under review would be a
 * bundle nobody can read. On merge, CI builds it, takes the sha256, signs that
 * with the release key and publishes both the bundle and an updated index.
 *
 * So this file is the *shape* of the index rather than its permanent home.
 * Today it is a constant, because the four addons on it are ours and ship
 * inside the app. When CI starts publishing, this gains a read of what it
 * published, and those entries stop being written by hand. Nothing downstream
 * changes: an entry is an entry.
 *
 * ## Why the manifests are imported rather than restated
 *
 * The Worker cannot read the repository at runtime, so the obvious thing is to
 * copy each manifest into a constant here. The obvious thing is wrong: the
 * manifest a user approves at install has to be the manifest the addon
 * actually ships with, and two copies of a permission list are two lists that
 * eventually disagree - at which point the install screen is describing a
 * different program from the one that runs.
 *
 * So each addon package exports its own `manifest.json` and this imports it.
 * The bundler inlines it, so the Worker still carries no filesystem read, and
 * there is exactly one copy of every permission list in the repository.
 *
 * ## Why the server owns the list at all
 *
 * The bundle could be fetched straight from wherever CI put it, and then there
 * would be no revoking it. An addon that turns out to be malicious after it was
 * approved has to stop being installable, and stop running where it already is,
 * without waiting for an app release. That is a list somebody controls, and it
 * is this one.
 */

export interface RegistryEntry {
  id: string;
  version: string;
  /** Where the bundle is. Relative for a bundled one; a CDN URL once CI
   *  publishes a community addon. */
  bundleUrl: string;
  /** sha256 of the bundle, as published. Empty until CI signs. */
  bundleHash: string;
  manifest: AddonManifest;
  /**
   * Withdrawn after the fact.
   *
   * Separate from simply not being listed: an addon that is merely absent is
   * one the app has never heard of, and an addon that is `revoked` is one the
   * app must *stop running* where it is already installed. The difference is
   * the whole reason the app asks this server rather than a static file.
   */
  revoked?: boolean;
  /** Shown on the addon's card. Who to blame, and who to thank. */
  author: string;
  /**
   * Ships inside the app rather than being downloaded.
   *
   * The difference the *user* sees is Install against a switch. A bundled
   * addon is already on the machine - its bundle is in the app's own static
   * directory, put there by its build - so there is nothing to fetch and
   * nothing to verify, and offering to "install" something already sitting on
   * disk is a button describing the implementation rather than the choice. It
   * is switched on and off instead, and `bundledEntries` is what the install
   * of record is seeded from the first time the list is read.
   *
   * A community addon keeps Install and Remove, because for it those words are
   * true: bytes arrive, a signature is checked, and removing it takes them off
   * the machine again.
   *
   * What is *not* different: the permissions, the sandbox, the capability
   * checks, the manifest parsing, the uninstall rule. A bundled addon travels
   * exactly the same path, which is the only way to know that path works - a
   * route only strangers' code takes is a route nobody maintains.
   */
  bundled?: boolean;
}

/**
 * The app's own five.
 *
 * Every guided session Wise Routine ships is an addon, and there is no
 * built-in activity type left. That is deliberate: the extension point is the
 * only point, so it cannot rot behind a shortcut only the app is allowed to
 * take. When somebody outside this repo writes their first one, the code path
 * it runs on has been in production for months.
 *
 * `daySoFar` is the same argument made about the other surface. It contributes
 * a card in the rail and no activity type at all, which is the shape most
 * community addons will have - so the widget path is one the app itself
 * depends on rather than one kept alive for strangers.
 */
const BUNDLED: readonly unknown[] = [
  breathing,
  eyeRest,
  stretch,
  deepWork,
  daySoFar,
];

/**
 * Every entry, validated the same way the client will validate it.
 *
 * `parseManifest` runs here rather than being trusted. A manifest that does not
 * parse would otherwise be an addon the client silently refuses to install with
 * no clue why; better that the server refuses to list it. It also means the
 * `unknown` above is not a shrug - a JSON import is a shape nobody checked, and
 * this is where it becomes an `AddonManifest`.
 */
export function registry(): RegistryEntry[] {
  const listed: RegistryEntry[] = [];

  for (const raw of BUNDLED) {
    const manifest = parseManifest(raw);
    if (!manifest) continue;
    listed.push({
      id: manifest.id,
      version: manifest.version,
      // The id, not a path written beside it. The desktop app stores a bundle
      // under the addon's id and serves it from there, so deriving the URL is
      // what stops the two from ever disagreeing.
      bundleUrl: `/addons/${manifest.id}/addon.js`,
      bundleHash: "",
      author: "Wise Routine",
      bundled: true,
      manifest,
    });
  }

  return listed;
}

export const entryFor = (id: string): RegistryEntry | undefined =>
  registry().find((entry) => entry.id === id);

/** The ones that ship with the app, and so are switched rather than installed. */
export const bundledEntries = (): RegistryEntry[] =>
  registry().filter((entry) => entry.bundled && !entry.revoked);
