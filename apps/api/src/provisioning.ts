import {
  ACTIVITY_TEMPLATES,
  applyMigrations,
  type Credentials,
  createActivity,
  createUserDatabase,
  type Directory,
  markDatabaseReady,
  USER_MIGRATIONS,
} from "@wiseroutine/db";
import { type ServerEnv, userCredentials } from "./env";

/**
 * Creating a user's database.
 *
 * This is the cost of one database per user: signup is no longer a row insert,
 * it is a provisioning step that can fail halfway. So it is written to be
 * idempotent and re-runnable - `databaseReady` on the directory row is the
 * only thing that says it finished, and nothing hands out a session until it
 * flips.
 */

const PLATFORM_API = "https://api.turso.tech/v1";

/**
 * Ask Turso to create the database.
 *
 * A 409 means it already exists, which happens whenever signup is retried
 * after a partial failure - treated as success, not an error.
 */
async function createTursoDatabase(
  env: ServerEnv,
  databaseName: string,
): Promise<void> {
  // A local `turso dev` server has no platform API and serves a single
  // database that already exists, so there is nothing to create.
  const host = env.TURSO_USER_HOST ?? "";
  if (host.startsWith("http://") || host.startsWith("https://")) return;

  const token = env.TURSO_PLATFORM_TOKEN;
  const org = env.TURSO_ORG;
  if (!token || !org) {
    throw new Error(
      "TURSO_PLATFORM_TOKEN and TURSO_ORG are required to provision a user database",
    );
  }

  const response = await fetch(
    `${PLATFORM_API}/organizations/${org}/databases`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: databaseName, group: env.TURSO_GROUP }),
    },
  );

  if (response.status === 409) return;
  if (!response.ok) {
    throw new Error(
      `Turso refused to create ${databaseName}: ${response.status} ${await response.text()}`,
    );
  }
}

export interface ProvisionResult {
  credentials: Credentials;
  applied: string[];
  seeded: number;
}

/**
 * Create, migrate and seed a user's database, then mark it ready.
 *
 * Safe to call again on a half-finished account: creation tolerates 409,
 * migrations track what they have applied, and seeding is skipped if the
 * database already has activities.
 */
export async function provisionUserDatabase(
  directory: Directory,
  env: ServerEnv,
  params: { userId: string; databaseName: string },
  now: number,
  newId: () => string,
): Promise<ProvisionResult> {
  await createTursoDatabase(env, params.databaseName);

  const credentials = userCredentials(env, params.databaseName);
  const { applied } = await applyMigrations(credentials, USER_MIGRATIONS);

  const db = createUserDatabase(credentials);
  let seeded = 0;

  // Give a new account the starter library from screen 3e, so the first plan
  // has something to place rather than an empty day.
  const existing = await db.activity.count();
  if (existing === 0) {
    for (const template of ACTIVITY_TEMPLATES) {
      await createActivity(db, template, now, newId);
      seeded++;
    }
  }

  await markDatabaseReady(directory, params.userId);

  return { credentials, applied, seeded };
}
