#!/usr/bin/env node

/**
 * Push secrets from a local env file into the Cloudflare Secrets Store.
 *
 *   pnpm --filter @wiseroutine/api secrets:push:dev
 *   pnpm --filter @wiseroutine/api secrets:push:prod -- --dry-run
 *
 * The file is `.env.dev` or `.env.prod` in this package, gitignored, holding
 * unprefixed names - `RESEND_API_KEY=re_...`, not `WR_PROD_RESEND_API_KEY`.
 * The prefix belongs to the store, where dev and production share one account
 * namespace; the file already knows which environment it is.
 *
 * Which secrets exist is not this script's opinion. It reads the
 * `secrets_store_secrets` entries in `wrangler.jsonc` - the same list the
 * deploy preflight checks - so a secret can never be pushed that nothing
 * binds, and one that is bound can never be quietly skipped.
 *
 * **This file is the weak point of the whole arrangement.** Until now the only
 * copy of a production secret was inside Cloudflare, where nothing can read it
 * back. A local `.env.prod` is a plaintext copy on a laptop, and it is only as
 * safe as the disk it sits on. Worth it for the convenience of one command;
 * worth knowing you made the trade.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  declared,
  fail,
  PKG,
  storeContents,
  varNames,
  wrangler,
} from "./secrets-lib.mjs";

const FILE = { dev: ".env.dev", production: ".env.prod" };

function args() {
  const { values } = parseArgs({
    options: {
      env: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.env || !FILE[values.env]) {
    console.error("usage: push-secrets.mjs --env <dev|production> [--dry-run]");
    process.exit(2);
  }
  return values;
}

/**
 * A deliberately small env parser.
 *
 * `KEY=value`, `#` comments, blank lines, and optional surrounding quotes.
 * Not dotenv: no interpolation, no multiline, no `export`. Every one of those
 * features is a way for the value that lands in Cloudflare to differ from the
 * text you read on screen, which is the last thing a secret file needs.
 */
function parseEnvFile(path) {
  const values = new Map();

  for (const [index, raw] of readFileSync(path, "utf8").split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) fail(`${FILE} line ${index + 1}: expected KEY=value`);

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // A quoted value is unwrapped once. An unquoted one keeps whatever is
    // there, minus the trim above - the common paste error is a trailing
    // space, not a deliberate one.
    const quoted = value.length >= 2 && /^(".*"|'.*')$/s.test(value);
    if (quoted) value = value.slice(1, -1);

    // Quotes are how you keep meaningful whitespace, so what is inside them is
    // otherwise left alone. But a value that is *only* whitespace is a paste
    // artifact rather than a credential, and pushing two spaces to Cloudflare
    // would look like success.
    values.set(key, value.trim() === "" ? "" : value);
  }

  return values;
}

/** Enough to catch a bad paste. Shape is the schema's job, and the deploy's
 *  `/health/config` gate is where it gets checked against the real value.
 *  Empty is not checked here - a blank line means "not set on this machine",
 *  handled with the absent case below. */
function problemWith(value) {
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    return "contains a control character - probably a copied line break";
  }
  if (/^['"]|['"]$/.test(value)) return "still has a stray quote";
  return null;
}

/** Enough to compare two pushes without ever printing the value. */
const fingerprint = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

function push(storeId, name, value, existingId, dryRun) {
  if (dryRun) {
    console.log(
      `  would ${existingId ? "update" : "create"} ${name} (${value.length} chars, sha ${fingerprint(value)})`,
    );
    return true;
  }

  // The value goes in on stdin, never as an argument: anything in argv is
  // visible to `ps` for the lifetime of the process.
  const result = wrangler(
    existingId
      ? [
          "secrets-store",
          "secret",
          "update",
          storeId,
          "--secret-id",
          existingId,
          "--remote",
        ]
      : [
          "secrets-store",
          "secret",
          "create",
          storeId,
          "--name",
          name,
          "--scopes",
          "workers",
          "--remote",
        ],
    { input: value, stdio: ["pipe", "pipe", "pipe"] },
  );

  if (result.status !== 0) {
    console.error(`  FAILED ${name}`);
    console.error(`${result.stdout}${result.stderr}`.trim());
    return false;
  }

  console.log(
    `  ${existingId ? "updated" : "created"} ${name} (${value.length} chars, sha ${fingerprint(value)})`,
  );
  return true;
}

function main() {
  const { env, "dry-run": dryRun } = args();
  const path = new URL(FILE[env], `file://${PKG}`);

  if (!existsSync(path)) {
    fail(
      `${FILE[env]} not found in apps/api. Create it with one KEY=value per` +
        " line - see docs/setup-api.md for the list.",
    );
  }

  const { storeId, names, prefix } = declared(env);
  const local = parseEnvFile(path);
  const existing = storeContents(storeId);

  console.log(
    `[secrets] env=${env} file=${FILE[env]} declared=${names.length} - ${
      dryRun ? "DRY RUN, nothing will be written" : "writing to Cloudflare"
    }`,
  );

  // Anything in the file that no binding wants is almost always a typo or a
  // leftover, and silently ignoring it is how someone spends an afternoon
  // wondering why their new key has no effect. But "not a secret" and "not
  // used" are different problems with different fixes, so they are said
  // differently.
  const wanted = new Set(names.map((name) => name.slice(prefix.length)));
  const vars = varNames();
  for (const key of local.keys()) {
    if (wanted.has(key)) continue;
    console.warn(
      vars.has(key)
        ? `  ${key} is a var, not a secret - the app does use it; set it in wrangler.jsonc under this environment's "vars", and delete it from ${FILE[env]}`
        : `  ignored ${key} - nothing in wrangler.jsonc uses it`,
    );
  }

  let failed = 0;
  let missing = 0;

  for (const name of names) {
    const key = name.slice(prefix.length);
    const value = local.get(key);

    // A blank `KEY=` reads the same as a key that is not in the file at all.
    // That is what makes the generated template usable: fill in the two you
    // have today, push, and come back for the rest - rather than being told
    // ten times that a value you have not obtained yet is invalid.
    if (value === undefined || value === "") {
      console.warn(`  absent ${key} - left as it is in the store`);
      missing++;
      continue;
    }

    const problem = problemWith(value);
    if (problem) {
      console.error(`  INVALID ${key} ${problem}`);
      failed++;
      continue;
    }

    if (!push(storeId, name, value, existing.get(name), dryRun)) failed++;
  }

  console.log(
    `[secrets] done - failed=${failed} absent=${missing}${dryRun ? "" : "\n[secrets] a rotated value reaches the Worker as isolates recycle; deploy to force it"}`,
  );

  // An absent key is not an error: it may already be in the store and simply
  // not on this machine. `secrets:check:*` is what says whether the set is
  // complete.
  if (failed > 0) process.exit(1);
}

main();
