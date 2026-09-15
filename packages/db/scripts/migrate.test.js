import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  applyMigrations,
  DIRECTORY_MIGRATIONS,
  USER_MIGRATIONS,
} from "../src/client.ts";
import { migrationStatus, runMigration } from "./migrate.mjs";
import { migrationConfig, migrationOptions } from "./migration-config.mjs";

const selected = (env, ...scope) => migrationOptions(["--env", env, ...scope]);
const deployment = (env) => ({
  vars: {
    ENVIRONMENT: env === "dev" ? "preview" : "production",
    TURSO_DIRECTORY_URL: `libsql://directory-${env}-org.turso.io`,
    TURSO_USER_HOST: "org.turso.io",
  },
});

test("targeting is explicit, strict and fail-closed before any database access", () => {
  for (const args of [
    [],
    ["--directory"],
    ["--env", "dev"],
    ["--env", "prod", "--directory"],
    ["--env", "dev", "--directory", "--all-users"],
    ["--env", "dev", "--user"],
    ["--env", "dev", "--user", ""],
    ["--env", "dev", "--user", "../other"],
    ["--env", "dev", "--direcotry"],
    ["--env", "dev", "--directory", "--env", "production"],
    ["--env", "local", "--user", "one"],
    ["--env", "production", "--directory"],
    ["--env", "dev", "--directory", "--confirm-production"],
  ])
    expect(() => migrationOptions(args), args.join(" ")).toThrow();
  expect(selected("production", "--directory", "--dry").dry).toBe(true);
  expect(
    selected("production", "--all-users", "--confirm-production").scope,
  ).toBe("users");
  expect(migrationOptions(["--help"])).toEqual({ help: true });
});

test("local selection cannot inherit a remote target or credential", () => {
  const config = migrationConfig(selected("local", "--all-users"), {
    TURSO_AUTH_TOKEN: "remote-secret",
    WR_PROD_TURSO_AUTH_TOKEN: "production-secret",
  });
  expect(config.directoryUrl).toBe("http://127.0.0.1:41080");
  expect(config.userHost).toBe("http://127.0.0.1:41081");
  expect(config.authToken).toBeUndefined();
  expect(() =>
    migrationConfig(selected("local", "--all-users"), {
      TURSO_DIRECTORY_URL: "http://localhost:41080",
      TURSO_USER_HOST: "http://127.0.0.1:41080",
    }),
  ).toThrow("separate ports");
  for (const key of ["TURSO_DIRECTORY_URL", "TURSO_USER_HOST"]) {
    for (const value of [
      "libsql://prod-org.turso.io",
      "https://api.example.com",
      "http://user:secret@localhost:41080",
      "http://localhost:41080/?token=secret",
    ]) {
      expect(() =>
        migrationConfig(selected("local", "--directory"), { [key]: value }),
      ).toThrow();
    }
  }
});

test("remote selection uses only matching named vars and prefixed credentials", () => {
  const load = vi.fn(deployment);
  const env = {
    TURSO_DIRECTORY_URL: "http://localhost:41080",
    TURSO_USER_HOST: "http://localhost:41081",
    TURSO_AUTH_TOKEN: "wrong",
    WR_DEV_TURSO_AUTH_TOKEN: "dev-only",
    WR_PROD_TURSO_AUTH_TOKEN: "prod-only",
  };
  expect(
    migrationConfig(selected("dev", "--directory"), env, load),
  ).toMatchObject({
    directoryUrl: "libsql://directory-dev-org.turso.io",
    authToken: "dev-only",
  });
  expect(
    migrationConfig(selected("production", "--directory", "--dry"), env, load),
  ).toMatchObject({
    directoryUrl: "libsql://directory-production-org.turso.io",
    authToken: "prod-only",
  });
  expect(load.mock.calls.map(([name]) => name)).toEqual(["dev", "production"]);
  expect(() =>
    migrationConfig(
      selected("dev", "--directory"),
      { TURSO_AUTH_TOKEN: "not-a-fallback" },
      load,
    ),
  ).toThrow("WR_DEV_TURSO_AUTH_TOKEN");
  for (const vars of [
    { ENVIRONMENT: "development" },
    { TURSO_DIRECTORY_URL: "libsql://directory-REPLACE_WITH_ORG.turso.io" },
    { TURSO_DIRECTORY_URL: "libsql://other-otherorg.turso.io" },
    { TURSO_USER_HOST: "http://localhost:41081" },
  ])
    expect(() =>
      migrationConfig(selected("dev", "--directory"), env, () => ({
        vars: { ...deployment("dev").vars, ...vars },
      })),
    ).toThrow();
});

const temp = [];
afterEach(() => {
  for (const dir of temp.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "wr-rollout-"));
  temp.push(dir);
  const url = (name) => `file:${join(dir, `${name}.db`)}`;
  const config = {
    environment: "local",
    directoryUrl: url("directory"),
    userHost: url("user"),
    scope: "directory",
    dry: false,
  };
  const log = vi.fn();
  return { config, url, log };
}
async function sql(url, statement, args = []) {
  const client = createClient({ url });
  try {
    return await client.execute({ sql: statement, args });
  } finally {
    client.close();
  }
}
const tables = async (url) =>
  (
    await sql(
      url,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
  ).rows;

test("dry run reports real pending names without creating schema or marker tables", async () => {
  const { config, log } = fixture();
  await runMigration({ ...config, dry: true }, { log });
  expect(log.mock.calls.flat().join("\n")).toContain(
    DIRECTORY_MIGRATIONS.at(-1).name,
  );
  expect(await tables(config.directoryUrl)).toEqual([]);
  expect(
    await migrationStatus({ url: config.directoryUrl }, DIRECTORY_MIGRATIONS),
  ).toHaveLength(DIRECTORY_MIGRATIONS.length);
});

test("user-only scope refuses an old directory without migrating either database", async () => {
  const { config, log } = fixture();
  await expect(
    runMigration({ ...config, scope: "users" }, { log }),
  ).rejects.toThrow("--directory first");
  expect(await tables(config.directoryUrl)).toEqual([]);
  expect(await tables(config.userHost)).toEqual([]);
});

test("directory-first local rollout reaches both latest schemas and reruns preserve saved data", async () => {
  const { config, log } = fixture();
  await runMigration(config, { log });
  expect(await tables(config.userHost)).toEqual([]);
  // Use an explicit file URL resolver only inside this disposable test fixture.
  const userUrl = () => config.userHost;
  await runMigration(
    { ...config, scope: "users", dry: true },
    { log, userUrl },
  );
  expect(await tables(config.userHost)).toEqual([]);
  await runMigration({ ...config, scope: "users" }, { log, userUrl });
  expect(
    await migrationStatus({ url: config.userHost }, USER_MIGRATIONS),
  ).toEqual([]);
  await sql(config.userHost, "CREATE TABLE preserved_work (value TEXT)");
  await sql(config.userHost, "INSERT INTO preserved_work VALUES ('keep-me')");
  await runMigration(config, { log });
  await runMigration({ ...config, scope: "users" }, { log, userUrl });
  expect(
    (await sql(config.userHost, "SELECT value FROM preserved_work")).rows,
  ).toEqual([{ value: "keep-me" }]);
});

test("disposable backup/restore rehearsal preserves account ownership and saved slots through upgrade", async () => {
  const { config, url, log } = fixture();
  await applyMigrations(
    { url: config.directoryUrl },
    DIRECTORY_MIGRATIONS.slice(0, -1),
  );
  await applyMigrations({ url: config.userHost }, USER_MIGRATIONS.slice(0, -1));
  await sql(
    config.directoryUrl,
    "INSERT INTO users (id,email,database_name,database_ready,created_at,updated_at) VALUES ('owner','owner@example.com','user',1,1,1)",
  );
  await sql(
    config.userHost,
    "INSERT INTO slots (id,title,kind,starts_at,ends_at,time_zone,created_at) VALUES ('saved-slot','Saved work','focus',1000,2000,'UTC',1)",
  );
  const ownership = async (directory) =>
    (await sql(directory, "SELECT id,email,database_name FROM users")).rows;
  const saved = async (user) =>
    (await sql(user, "SELECT id,title,starts_at,ends_at FROM slots")).rows;
  const beforeOwner = await ownership(config.directoryUrl);
  const beforeWork = await saved(config.userHost);
  for (const [source, target] of [
    [config.directoryUrl, url("directory-backup")],
    [config.userHost, url("user-backup")],
  ]) {
    await sql(source, "VACUUM INTO ?", [target.slice(5)]);
  }
  const upgrade = async (target) => {
    await runMigration(target, { log });
    await runMigration(
      { ...target, scope: "users" },
      { log, userUrl: () => target.userHost },
    );
    expect(await ownership(target.directoryUrl)).toEqual(beforeOwner);
    expect(await saved(target.userHost)).toEqual(beforeWork);
  };
  await upgrade(config);
  const restored = {
    ...config,
    directoryUrl: url("restored-directory"),
    userHost: url("restored-user"),
  };
  copyFileSync(
    url("directory-backup").slice(5),
    restored.directoryUrl.slice(5),
  );
  copyFileSync(url("user-backup").slice(5), restored.userHost.slice(5));
  expect(
    await migrationStatus({ url: restored.directoryUrl }, DIRECTORY_MIGRATIONS),
  ).toHaveLength(1);
  expect(
    await migrationStatus({ url: restored.userHost }, USER_MIGRATIONS),
  ).toHaveLength(1);
  await upgrade(restored);
});

async function registered() {
  const f = fixture();
  await runMigration(f.config, { log: f.log });
  for (const [name, ready, deleted] of [
    ["first", 1, null],
    ["second", 1, null],
    ["incomplete", 0, null],
    ["deleted", 1, 1],
  ]) {
    await sql(
      f.config.directoryUrl,
      "INSERT INTO users (id,email,database_name,database_ready,created_at,updated_at,deleted_at) VALUES (?,?,?,?,1,1,?)",
      [name, `${name}@example.com`, name, ready, deleted],
    );
  }
  return { ...f, config: { ...f.config, environment: "dev", scope: "users" } };
}

test("named user must belong to the selected directory; it cannot migrate another tenant", async () => {
  const { config, log, url } = await registered();
  const userUrl = vi.fn((name) => url(name));
  for (const user of ["unregistered", "deleted", "incomplete"]) {
    await expect(
      runMigration({ ...config, user }, { log, userUrl }),
    ).rejects.toThrow("active, provisioned");
  }
  expect(userUrl).not.toHaveBeenCalled();
  await runMigration({ ...config, user: "second" }, { log, userUrl });
  expect(userUrl).toHaveBeenCalledTimes(1);
  expect(userUrl.mock.calls[0][0]).toBe("second");
  expect(
    await migrationStatus({ url: url("second") }, USER_MIGRATIONS),
  ).toEqual([]);
  expect(await tables(url("first"))).toEqual([]);
});

test("a user mapping cannot apply user migrations to the directory", async () => {
  const { config, log } = await registered();
  const before = await tables(config.directoryUrl);
  await expect(
    runMigration(config, { log, userUrl: () => config.directoryUrl }),
  ).rejects.toThrow("resolves to the directory");
  expect(await tables(config.directoryUrl)).toEqual(before);
  expect(
    await migrationStatus({ url: config.directoryUrl }, DIRECTORY_MIGRATIONS),
  ).toEqual([]);
});

test("unknown markers fail closed; one failed user does not hide other results", async () => {
  const { config, log, url } = await registered();
  await sql(
    url("first"),
    "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)",
  );
  await sql(
    url("first"),
    "INSERT INTO _migrations VALUES ('future-migration', 1)",
  );
  await expect(
    runMigration(config, { log, userUrl: (name) => url(name) }),
  ).rejects.toThrow("1 user database(s) failed");
  expect(log.mock.calls.flat().join("\n")).toContain(
    "FAIL first: Database contains unknown",
  );
  expect(
    await migrationStatus({ url: url("second") }, USER_MIGRATIONS),
  ).toEqual([]);
  expect(await tables(url("incomplete"))).toEqual([]);
  expect(await tables(url("deleted"))).toEqual([]);
});
