#!/usr/bin/env node
/** Explicit, directory-first rollout. Never loads dotenv files or deploys a Worker. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import {
  applyMigrations,
  DIRECTORY_MIGRATIONS,
  USER_MIGRATIONS,
  userDatabaseUrl,
} from "../src/client.ts";
import {
  HELP,
  migrationConfig,
  migrationOptions,
  validateDatabaseName,
} from "./migration-config.mjs";

/** Read-only: even an empty database must not acquire a marker table on --dry. */
export async function migrationStatus(credentials, migrations) {
  const client = createClient(credentials);
  try {
    const table = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
    );
    const applied = table.rows.length
      ? (await client.execute("SELECT name FROM _migrations")).rows.map((row) =>
          String(row.name),
        )
      : [];
    const known = new Set(migrations.map((migration) => migration.name));
    if (applied.some((name) => !known.has(name)))
      throw new Error(
        "Database contains unknown migration markers; use the correct application revision before proceeding",
      );
    return migrations
      .filter((migration) => !applied.includes(migration.name))
      .map((migration) => migration.name);
  } finally {
    client.close();
  }
}

async function userNames(credentials) {
  const client = createClient(credentials);
  try {
    const result = await client.execute(
      "SELECT database_name FROM users WHERE deleted_at IS NULL AND database_ready = 1 ORDER BY created_at ASC",
    );
    return [
      ...new Set(
        result.rows.map((row) => validateDatabaseName(row.database_name)),
      ),
    ];
  } finally {
    client.close();
  }
}

export async function runMigration(
  config,
  { log = console.log, userUrl = userDatabaseUrl } = {},
) {
  const creds = (url) => ({
    url,
    ...(config.authToken ? { authToken: config.authToken } : {}),
  });
  const redact = (error) =>
    config.authToken
      ? String(error.message).replaceAll(config.authToken, "[redacted]")
      : String(error.message);
  log(
    `environment ${config.environment} · ${config.dry ? "read-only dry run" : "apply migrations"}`,
  );
  log(`directory   ${config.directoryUrl}`);
  const directoryPending = await migrationStatus(
    creds(config.directoryUrl),
    DIRECTORY_MIGRATIONS,
  );
  if (config.scope === "directory") {
    log(
      `directory: ${directoryPending.length ? directoryPending.join(", ") : "already current"}`,
    );
    if (!config.dry)
      await applyMigrations(creds(config.directoryUrl), DIRECTORY_MIGRATIONS);
    return;
  }
  if (directoryPending.length)
    throw new Error(
      "Directory migrations are pending; run --directory first. No user databases were changed",
    );
  // A local server has one shared database, even when no user has signed up.
  const names =
    config.environment === "local"
      ? ["local-shared-user"]
      : await userNames(creds(config.directoryUrl));
  if (config.user && !names.includes(config.user))
    throw new Error(
      "Requested database is not an active, provisioned user in the selected directory",
    );
  const selected = config.user ? [config.user] : names;
  log(
    `${selected.length} user database(s) selected${config.environment === "local" ? " (shared local endpoint)" : " (active, provisioned accounts only)"}`,
  );
  const targets = selected.map((name) => ({
    name,
    url: userUrl(name, config.userHost),
  }));
  const directoryOrigin = new URL(config.directoryUrl);
  for (const { url } of targets) {
    const target = new URL(url);
    if (
      target.href === directoryOrigin.href ||
      (config.environment !== "local" &&
        target.hostname &&
        target.hostname === directoryOrigin.hostname)
    ) {
      throw new Error(
        "A user target resolves to the directory database; no user migrations were applied",
      );
    }
  }
  let failed = 0;
  for (const { name, url } of targets) {
    try {
      const pending = await migrationStatus(creds(url), USER_MIGRATIONS);
      log(
        `${name} ${url}: ${pending.length ? pending.join(", ") : "already current"}`,
      );
      if (!config.dry) await applyMigrations(creds(url), USER_MIGRATIONS);
    } catch (error) {
      failed++;
      log(`FAIL ${name}: ${redact(error)}`);
    }
  }
  if (failed)
    throw new Error(
      `${failed} user database(s) failed; review the output and rerun the same explicit scope`,
    );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  let config;
  try {
    config = migrationConfig(migrationOptions(process.argv.slice(2)));
    if (config.help) console.log(HELP);
    else {
      await runMigration(config);
      console.log(
        config.dry
          ? "Read-only inspection complete. No migration writes performed."
          : "Migration run complete. Connectivity, provisioning, backup recovery and application smoke tests remain separate gates.",
      );
    }
  } catch (error) {
    const message = config?.authToken
      ? String(error.message).replaceAll(config.authToken, "[redacted]")
      : error.message;
    console.error(`[migrate] ${message}`);
    process.exitCode = 1;
  }
}
