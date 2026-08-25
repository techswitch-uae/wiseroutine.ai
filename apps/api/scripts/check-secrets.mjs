#!/usr/bin/env node
/**
 * Refuse to deploy against a Secrets Store that is missing something.
 *
 * `wrangler.jsonc` is the list of secrets an environment requires — one
 * `secrets_store_secrets` entry per binding. This checks every name actually
 * exists in the account store before `wrangler deploy` runs, so a forgotten
 * secret is a failed command rather than a 500 on the first request that
 * needs it.
 *
 * It can only check *presence*. Cloudflare never lets a stored secret be read
 * back — that is the point of the store — so whether the value is the right
 * shape is answered after the upload, by `GET /health/config`, which resolves
 * the bindings inside the Worker and runs the schema over them. Between the
 * two, "missing or invalid" fails the deploy.
 *
 *   node scripts/check-secrets.mjs --env production
 */

import { parseArgs } from "node:util";
import { declared, PREFIX, storeContents } from "./secrets-lib.mjs";

function args() {
  const { values } = parseArgs({
    options: { env: { type: "string" } },
    strict: true,
  });
  if (!values.env || !PREFIX[values.env]) {
    console.error("usage: check-secrets.mjs --env <dev|production>");
    process.exit(2);
  }
  return values;
}

function main() {
  const { env } = args();
  const { storeId, names } = declared(env);
  const shortEnv = env === "production" ? "prod" : "dev";

  console.log(
    `[check-secrets] env=${env} declared=${names.length} store=${storeId}`,
  );

  const present = storeContents(storeId);
  const missing = names.filter((name) => !present.has(name));

  for (const name of names) {
    console.log(`  ${missing.includes(name) ? "MISSING" : "ok     "} ${name}`);
  }

  if (missing.length > 0) {
    console.error(
      `\n[check-secrets] ${missing.length} missing. Put them in .env.${shortEnv} and run:\n` +
        `  pnpm --filter @wiseroutine/api secrets:push:${shortEnv}`,
    );
    process.exit(1);
  }

  console.log("[check-secrets] all present");
}

main();
