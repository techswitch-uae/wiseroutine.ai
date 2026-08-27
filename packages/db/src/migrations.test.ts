import { describe, expect, test } from "vitest";
import { splitStatements } from "./client";
import { DIRECTORY_MIGRATIONS, USER_MIGRATIONS } from "./generated/migrations";

/**
 * The splitter used to drop every chunk beginning with `--`. Since Prisma
 * precedes each statement with a `-- CreateTable` comment, that meant no
 * statement survived: `applyMigrations` created an empty database and recorded
 * the migration as applied, so it never retried. Silent, and it reached the
 * signup path that provisions a real user's database.
 */
describe("splitStatements", () => {
  const migrations = [...DIRECTORY_MIGRATIONS, ...USER_MIGRATIONS];

  test("keeps every CREATE in the embedded migrations", () => {
    for (const migration of migrations) {
      const expected = (migration.sql.match(/^CREATE /gm) ?? []).length;
      expect(expected).toBeGreaterThan(0);
      expect(splitStatements(migration.sql)).toHaveLength(expected);
    }
  });

  test("emits no comment-only or empty statements", () => {
    for (const migration of migrations) {
      for (const statement of splitStatements(migration.sql)) {
        expect(statement).not.toMatch(/^\s*(--|$)/);
      }
    }
  });

  test("strips the comment but keeps the statement it labels", () => {
    expect(
      splitStatements('-- CreateTable\nCREATE TABLE "t" (\n  "a" INT\n);\n'),
    ).toEqual(['CREATE TABLE "t" (\n  "a" INT\n)']);
  });
});
