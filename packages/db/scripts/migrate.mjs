#!/usr/bin/env node
/**
 * Apply every unapplied migration, to the directory and to every user database.
 *
 *   pnpm db:migrate                  # local `turso dev` servers
 *   pnpm db:migrate --dry            # say what would run, change nothing
 *   pnpm db:migrate --directory      # the directory only
 *   pnpm db:migrate --user <name>    # one user database
 *
 * One database per user means a schema change is not one migration run but
 * N+1, and the ones that matter most are the ones nobody remembers: a signup
 * from last month whose owner has not opened the app since. So this walks the
 * directory's user list rather than taking a name, and reports each database
 * by name so a failure halfway is legible rather than a count.
 *
 * Nothing here decides what "unapplied" means. `applyMigrations` tracks names
 * in a `_migrations` table and skips what it finds there - the same function
 * the Worker calls when it provisions a database at signup, so a database
 * created tomorrow and one migrated today go through identical code.
 *
 * Reads `TURSO_DIRECTORY_URL`, `TURSO_USER_HOST` and `TURSO_AUTH_TOKEN` from
 * the environment, falling back to `apps/api/.dev.vars` and then to the local
 * defaults from `wrangler.jsonc`. Pointing it at production is an explicit act.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import {
  applyMigrations,
  DIRECTORY_MIGRATIONS,
  USER_MIGRATIONS,
  userDatabaseUrl,
} from "../src/index.ts";

/** The two `turso dev` servers from the top-level wrangler config. */
const LOCAL = {
  TURSO_DIRECTORY_URL: "http://127.0.0.1:41080",
  TURSO_USER_HOST: "http://127.0.0.1:41081",
};

function devVars() {
  try {
    const path = new URL("../../../apps/api/.dev.vars", import.meta.url);
    const found = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      if (match) found[match[1]] = match[2];
    }
    return found;
  } catch {
    // Normal when the credentials are already exported, and normal locally.
    return {};
  }
}

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const directoryOnly = args.includes("--directory");
const oneUser = args.includes("--user")
  ? args[args.indexOf("--user") + 1]
  : null;

const fallback = devVars();
const pick = (key) => process.env[key] ?? fallback[key] ?? LOCAL[key];

const directoryUrl = pick("TURSO_DIRECTORY_URL");
const userHost = pick("TURSO_USER_HOST");
const authToken = pick("TURSO_AUTH_TOKEN");
const creds = (url) => ({ url, ...(authToken ? { authToken } : {}) });

if (!directoryUrl) {
  console.error("TURSO_DIRECTORY_URL is not set and has no local default.");
  process.exit(1);
}

console.log(`directory  ${directoryUrl}`);
console.log(`users      ${userHost ?? "(skipped - no TURSO_USER_HOST)"}`);
console.log(
  `${DIRECTORY_MIGRATIONS.length} directory and ${USER_MIGRATIONS.length} user migration(s) known${
    dry ? " · dry run" : ""
  }\n`,
);

let failed = 0;

/** Every live user's database, oldest first. */
async function userDatabaseNames() {
  const client = createClient(creds(directoryUrl));
  try {
    const result = await client.execute(
      "SELECT database_name FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC",
    );
    return result.rows.map((row) => String(row.database_name));
  } finally {
    client.close();
  }
}

/** Run one database, and keep going if it fails. */
async function migrate(label, url, migrations) {
  if (dry) {
    console.log(`  dry   ${label}`);
    return;
  }
  try {
    const { applied } = await applyMigrations(creds(url), migrations);
    console.log(
      applied.length > 0
        ? `  ok    ${label} — applied ${applied.join(", ")}`
        : `  --    ${label} — already current`,
    );
  } catch (error) {
    // Reported and counted rather than thrown. One unreachable database must
    // not stop the other four hundred from being migrated, and a run that
    // stopped a third of the way through is the worst possible state to be
    // left in.
    failed += 1;
    console.error(`  FAIL  ${label} — ${error.message}`);
  }
}

await migrate("directory", directoryUrl, DIRECTORY_MIGRATIONS);

if (!directoryOnly && userHost) {
  // One column from one table, read with the same libSQL client
  // `applyMigrations` uses. Prisma would mean loading its query engine to ask
  // a question that fits on one line, and the generated client is built for a
  // bundler rather than for a script.
  const names = oneUser ? [oneUser] : await userDatabaseNames();

  console.log(`\n${names.length} user database(s)`);
  for (const name of names) {
    await migrate(name, userDatabaseUrl(name, userHost), USER_MIGRATIONS);
  }
}

if (failed > 0) {
  console.error(`\n${failed} database(s) failed. Re-run to retry just those.`);
  process.exit(1);
}
console.log("\nDone.");
