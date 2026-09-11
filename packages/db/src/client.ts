import { type Client, createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient as DirectoryClient } from "./generated/directory/client";
import {
  DIRECTORY_MIGRATIONS,
  type Migration,
  USER_MIGRATIONS,
} from "./generated/migrations";
import { PrismaClient as UserClient } from "./generated/user/client";

/**
 * Two tiers.
 *
 * `Directory` is one shared database holding only what must be queried across
 * users - login, sessions, billing, and the coordination table the cron ticker
 * reads. `UserDatabase` is one database per person, holding everything they
 * own. The split means a query physically cannot cross a user boundary.
 *
 * Both are Turso (libSQL) over HTTP, so neither is a Worker binding: they are
 * a URL plus an auth token, resolved per request.
 */
type TransactionView<T> = Omit<
  T,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
export type Directory = DirectoryClient | TransactionView<DirectoryClient>;
export type UserDatabase = UserClient | TransactionView<UserClient>;

// Prisma versions that support savepoints may expose $transaction even on a
// scoped client. Detect our scope explicitly, not by property existence.
const transactionScopes = new WeakSet<object>();
export const isTransaction = (db: object): boolean => transactionScopes.has(db);

/** Acquire the SQLite writer before reading state used by a mutation. Nested
 * repository operations reuse the caller's transaction rather than committing
 * independently. This also serializes concurrent plans and action replays. */
export async function userTransaction<T>(
  db: UserDatabase,
  work: (tx: UserDatabase) => Promise<T>,
): Promise<T> {
  if (isTransaction(db) || !("$transaction" in db)) return work(db);
  return db.$transaction(async (tx) => {
    transactionScopes.add(tx);
    await tx.$executeRawUnsafe("UPDATE _write_lock SET version = version + 1 WHERE id = 1");
    return work(tx);
  }, { timeout: 30_000, maxWait: 10_000 });
}

export async function directoryTransaction<T>(
  db: Directory,
  work: (tx: Directory) => Promise<T>,
): Promise<T> {
  if (isTransaction(db) || !("$transaction" in db)) return work(db);
  return db.$transaction(async (tx) => {
    transactionScopes.add(tx);
    await tx.$executeRawUnsafe("UPDATE _write_lock SET version = version + 1 WHERE id = 1");
    return work(tx);
  }, { timeout: 30_000, maxWait: 10_000 });
}

export interface Credentials {
  url: string;
  authToken?: string | undefined;
}

export function createDirectory(credentials: Credentials): DirectoryClient {
  return new DirectoryClient({ adapter: new PrismaLibSql(credentials) });
}

export function createUserDatabase(credentials: Credentials): UserClient {
  return new UserClient({ adapter: new PrismaLibSql(credentials) });
}

/**
 * Where a user's database lives.
 *
 * All user databases sit in one Turso group, so a single group-scoped token
 * reaches all of them and only the name varies. In local development every
 * name resolves to the same `turso dev` server, which has no concept of
 * multiple databases - see `TURSO_USER_HOST`.
 */
export function userDatabaseUrl(databaseName: string, host: string): string {
  // A local dev server serves exactly one database, so the name is ignored.
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `libsql://${databaseName}-${host}`;
}

/**
 * Instant conversion at the storage boundary.
 *
 * The application works in epoch-millisecond numbers throughout - the scheduler
 * is built on them - while Prisma models instants as `DateTime`, because Prisma
 * range-checks `Int` at 32 bits and epoch ms is ~1.7e12. Converting here keeps
 * that mismatch in one place.
 *
 * This lives apart from index.ts so the repositories can import it without a
 * cycle through the barrel that re-exports them.
 */
export const at = (ms: number): Date => new Date(ms);
export const atOrNull = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms);
export const ms = (date: Date): number => date.getTime();
export const msOrNull = (date: Date | null | undefined): number | null =>
  date === null || date === undefined ? null : date.getTime();

/* ── Migrations ──────────────────────────────────────────────────────────── */

export { DIRECTORY_MIGRATIONS, type Migration, USER_MIGRATIONS };

/**
 * Split a migration file into single statements.
 *
 * libSQL executes one statement per call. Prisma terminates each with `;` on
 * its own line and precedes it with a `-- CreateTable` style comment, so the
 * comments have to be stripped per *line*: dropping any chunk that starts with
 * `--` drops every statement, and the migration then applies nothing while
 * still recording itself as applied.
 *
 * ponytail: line-based, so a `--` inside a string literal would be cut. Prisma
 * does not emit those; revisit if a hand-written migration ever does.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split(";\n")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

/**
 * Apply pending migrations to a libSQL database.
 *
 * Runs in the Worker as well as in Node, because provisioning a new user's
 * database happens at signup - which is also why the SQL is embedded in the
 * bundle rather than read from disk.
 *
 * Applied names are tracked in `_migrations`, so this is safe to call on every
 * connection to a database that may or may not be new.
 */
export async function applyMigrations(
  credentials: Credentials,
  migrations: readonly Migration[],
): Promise<{ applied: string[] }> {
  const client: Client = createClient(credentials);
  const applied: string[] = [];

  try {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name TEXT PRIMARY KEY,
         applied_at INTEGER NOT NULL
       )`,
    );

    for (const migration of migrations) {
      // The write transaction is acquired before the marker is read. Concurrent
      // catch-ups cannot both decide to run the same ALTER TABLE.
      const tx = await client.transaction("write");
      try {
        const done = await tx.execute({
          sql: "SELECT name FROM _migrations WHERE name = ?",
          args: [migration.name],
        });
        if (done.rows.length === 0) {
          for (const statement of splitStatements(migration.sql)) {
            await tx.execute(statement);
          }
          await tx.execute({
            sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
            args: [migration.name, Date.now()],
          });
        }
        await tx.commit();
        if (done.rows.length === 0) applied.push(migration.name);
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
    }
  } finally {
    client.close();
  }

  return { applied };
}
