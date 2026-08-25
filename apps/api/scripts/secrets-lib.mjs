/**
 * What `check-secrets.mjs` and `push-secrets.mjs` both need.
 *
 * `wrangler.jsonc` is the declaration of which secrets an environment
 * requires — one `secrets_store_secrets` entry per binding. Both scripts read
 * it rather than keeping their own list, so there is no second place to update
 * and no drift to detect.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** wrangler is a dependency of apps/api, not of the root, so every command
 *  runs from here regardless of where the script was invoked. */
export const PKG = fileURLToPath(new URL("..", import.meta.url));

export const PREFIX = { dev: "WR_DEV_", production: "WR_PROD_" };

/**
 * Pull the store id and secret names out of wrangler.jsonc.
 *
 * A regex rather than a JSONC parser: these are two flat string fields with no
 * escaping or nesting to get wrong, and the alternative is a dependency whose
 * only job is to strip comments. If the shape ever gets more interesting than
 * this, that trade stops being worth it.
 */
export function declared(env) {
  const text = readFileSync(new URL("wrangler.jsonc", `file://${PKG}`), "utf8");
  const prefix = PREFIX[env];

  const names = [...text.matchAll(/"secret_name":\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((name) => name.startsWith(prefix));

  const stores = new Set(
    [...text.matchAll(/"store_id":\s*"([^"]+)"/g)].map((m) => m[1]),
  );

  if (names.length === 0) {
    fail(`no ${prefix}* secrets declared for env=${env}`);
  }

  if ([...stores].some((id) => id.startsWith("REPLACE_WITH"))) {
    fail(
      "wrangler.jsonc still has a placeholder store_id — run" +
        " `pnpm wrangler secrets-store store list --remote` and paste the id in",
    );
  }

  // One store per account today, so every binding shares an id.
  return { storeId: [...stores][0], names, prefix };
}

export function fail(message) {
  console.error(`[secrets] ${message}`);
  process.exit(1);
}

export function wrangler(args, options = {}) {
  return spawnSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    cwd: PKG,
    ...options,
  });
}

/**
 * Every secret currently in the store, as name → id.
 *
 * The id is what `secret update` takes; `create` takes the name. So knowing
 * which of the two a push needs means listing first.
 */
export function storeContents(storeId) {
  const result = wrangler([
    "secrets-store",
    "secret",
    "list",
    storeId,
    "--remote",
    "--per-page",
    "100",
  ]);

  const output = `${result.stdout}${result.stderr}`;

  // An empty store is a non-zero exit with this message, not an empty list.
  // That is the state of a fresh account, and the right answer there is "all
  // of them are missing, here is how to add one" — not "the listing failed",
  // which sends you looking for a permissions problem you don't have.
  if (output.includes("returned no secrets")) return new Map();

  if (result.status !== 0) {
    console.error("[secrets] could not list the store:");
    console.error(output);
    process.exit(1);
  }

  // The listing is a box-drawn table. Rows are the lines with data cells;
  // columns one and two are Name and ID.
  const found = new Map();
  for (const line of result.stdout.split("\n")) {
    if (!line.startsWith("│")) continue;
    const cells = line
      .split("│")
      .map((cell) => cell.trim())
      .filter(Boolean);
    const [name, id] = cells;
    if (!name || !id || name === "Name") continue;
    found.set(name, id);
  }

  return found;
}
