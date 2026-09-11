/// <reference types="node" />
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { applyMigrations } from "./client";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function database() {
  const dir = await mkdtemp(join(tmpdir(), "wr-migration-")); dirs.push(dir);
  return { url: `file:${join(dir, "db.sqlite")}` };
}

test("failed migration rolls back its DDL and can be retried", async () => {
  const credentials = await database();
  await expect(applyMigrations(credentials, [{ name: "one", sql: "CREATE TABLE example (id INT);\nINVALID STATEMENT;\n" }])).rejects.toThrow();
  const client = createClient(credentials);
  expect((await client.execute("SELECT name FROM sqlite_master WHERE name = 'example'")).rows).toHaveLength(0);
  expect((await client.execute("SELECT name FROM _migrations")).rows).toHaveLength(0);
  const migrations = [{ name: "one", sql: "CREATE TABLE example (id INT);\n" }];
  expect((await applyMigrations(credentials, migrations)).applied).toEqual(["one"]);
  expect((await applyMigrations(credentials, migrations)).applied).toEqual([]);
  client.close();
});

test("failure writing a migration marker rolls back the schema change too", async () => {
  const credentials = await database();
  await applyMigrations(credentials, []);
  const client = createClient(credentials);
  await client.execute("CREATE TRIGGER refuse_marker BEFORE INSERT ON _migrations BEGIN SELECT RAISE(ABORT, 'marker failed'); END");
  await expect(applyMigrations(credentials, [{ name: "one", sql: "CREATE TABLE example (id INT);\n" }])).rejects.toThrow();
  expect((await client.execute("SELECT name FROM sqlite_master WHERE name = 'example'")).rows).toHaveLength(0);
  await client.execute("DROP TRIGGER refuse_marker");
  expect((await applyMigrations(credentials, [{ name: "one", sql: "CREATE TABLE example (id INT);\n" }])).applied).toEqual(["one"]);
  client.close();
});
