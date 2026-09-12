/// <reference types="node" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "vitest";
import { applyMigrations } from "./client";
import { USER_MIGRATIONS } from "./generated/migrations";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function database() {
  const dir = await mkdtemp(join(tmpdir(), "wr-migration-"));
  dirs.push(dir);
  return { url: `file:${join(dir, "db.sqlite")}` };
}

test("capture migration repairs stranded todos while preserving activity identity and bucket links", async () => {
  const credentials = await database();
  const index = USER_MIGRATIONS.findIndex((m) => m.name.startsWith("0015_"));
  expect(index).toBeGreaterThan(0);
  await applyMigrations(credentials, USER_MIGRATIONS.slice(0, index));
  const client = createClient(credentials);
  try {
    await client.execute(
      "INSERT INTO activities(id,name,kind,minimum_type,minimum_value,session_minutes,created_at) VALUES ('activity','Read','focus','countPerDay',1,20,0)",
    );
    for (const status of [
      "completed",
      "cancelled",
      "skipped",
      "missed",
      "bucketed",
      "planned",
      "missing",
    ]) {
      if (status !== "missing")
        await client.execute({
          sql: "INSERT INTO slots(id,activity_id,reminder_id,title,kind,starts_at,ends_at,time_zone,status,created_at) VALUES (?,'activity',?,'Read','focus',0,1200000,'UTC',?,0)",
          args: [`slot-${status}`, `todo-${status}`, status],
        });
      await client.execute({
        sql: "INSERT INTO reminders(id,title,due_window,status,slot_id,created_at) VALUES (?,'Read','date','slotted',?,0)",
        args: [`todo-${status}`, `slot-${status}`],
      });
    }
    await applyMigrations(credentials, USER_MIGRATIONS.slice(0, index + 1));
    // Use the explicit projection used by Prisma. A pre-migration local
    // libsql connection can report stale column names for SELECT * after DDL.
    const rows = (
      await client.execute(
        "SELECT id,status,slot_id,activity_id,notes,links_json FROM reminders",
      )
    ).rows;
    for (const row of rows) {
      const original = String(row.id).slice(5);
      expect(row.status).toBe(
        original === "completed"
          ? "done"
          : original === "planned"
            ? "slotted"
            : "open",
      );
      expect(row.activity_id).toBe(original === "missing" ? null : "activity");
      expect(row.slot_id).toBe(
        ["completed", "bucketed", "planned"].includes(original)
          ? `slot-${original}`
          : null,
      );
      expect(row.notes).toBe("");
      expect(row.links_json).toBe("[]");
    }
    expect(
      (await applyMigrations(credentials, USER_MIGRATIONS.slice(0, index + 1)))
        .applied,
    ).toEqual([]);
  } finally {
    client.close();
  }
});

test("failed migration rolls back its DDL and can be retried", async () => {
  const credentials = await database();
  await expect(
    applyMigrations(credentials, [
      {
        name: "one",
        sql: "CREATE TABLE example (id INT);\nINVALID STATEMENT;\n",
      },
    ]),
  ).rejects.toThrow();
  const client = createClient(credentials);
  expect(
    (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE name = 'example'",
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (await client.execute("SELECT name FROM _migrations")).rows,
  ).toHaveLength(0);
  const migrations = [{ name: "one", sql: "CREATE TABLE example (id INT);\n" }];
  expect((await applyMigrations(credentials, migrations)).applied).toEqual([
    "one",
  ]);
  expect((await applyMigrations(credentials, migrations)).applied).toEqual([]);
  client.close();
});

test("failure writing a migration marker rolls back the schema change too", async () => {
  const credentials = await database();
  await applyMigrations(credentials, []);
  const client = createClient(credentials);
  await client.execute(
    "CREATE TRIGGER refuse_marker BEFORE INSERT ON _migrations BEGIN SELECT RAISE(ABORT, 'marker failed'); END",
  );
  await expect(
    applyMigrations(credentials, [
      { name: "one", sql: "CREATE TABLE example (id INT);\n" },
    ]),
  ).rejects.toThrow();
  expect(
    (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE name = 'example'",
      )
    ).rows,
  ).toHaveLength(0);
  await client.execute("DROP TRIGGER refuse_marker");
  expect(
    (
      await applyMigrations(credentials, [
        { name: "one", sql: "CREATE TABLE example (id INT);\n" },
      ])
    ).applied,
  ).toEqual(["one"]);
  client.close();
});
