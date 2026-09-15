import { type ChildProcess, spawn } from "node:child_process";
import {
  applyMigrations,
  DIRECTORY_MIGRATIONS,
  USER_MIGRATIONS,
} from "@wiseroutine/db";
import { DIRECTORY_URL, PORTS, SECOND_USER_URL, USER_URL } from "./environment";

/**
 * Three libSQL servers that live for exactly one run.
 *
 * Turso is an HTTP service rather than a Worker binding, so the Worker under
 * test needs real endpoints - it cannot be handed a file. `turso dev` serves
 * one database per instance: one directory and two independent fixture tenants.
 * In memory, so there is nothing left on disk afterwards and nothing to
 * inherit from the run before.
 *
 * Ordinary fixtures still use the primary tenant. Cross-account scenarios
 * explicitly select the second tenant through a guarded test-only mapping.
 * `/test/reset` clears all three databases before each scenario. This exercises
 * independent datasets, not production Turso hostname routing or authorization.
 */

const servers: ChildProcess[] = [];

/**
 * `turso dev` is a wrapper: it spawns the `sqld` that actually holds the port.
 * Killing the wrapper leaves `sqld` orphaned and still listening, so the next
 * run finds the port taken, fails to bind, and talks to the previous run's
 * database instead. `detached` puts the pair in their own process group, which
 * teardown can then signal as a whole.
 */
function startServer(port: number): void {
  const child = spawn("turso", ["dev", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.on("error", (error) => {
    throw new Error(
      `Could not start \`turso dev\` on port ${port}. The Turso CLI is required to run these tests - see SETUP.md. (${error.message})`,
    );
  });
  servers.push(child);
}

/**
 * Refuse to run against a server we did not start.
 *
 * `turso dev` binds `*:PORT` while most servers bind `127.0.0.1:PORT`, and the
 * specific bind wins - so when something already holds the port, the spawn
 * fails quietly, the wait below succeeds against the *other* process, and the
 * whole suite runs on someone else's database. Which is the entire failure
 * this file exists to prevent, so it is worth an explicit check.
 */
async function assertPortFree(port: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
  } catch {
    return; // Nothing listening, which is what we want.
  }
  throw new Error(
    `Something is already listening on 127.0.0.1:${port}. The e2e suite needs ` +
      `ports ${PORTS.directory} and ${PORTS.user} to itself. ` +
      `(\`lsof -nP -iTCP:${port} -sTCP:LISTEN\` to find it.)`,
  );
}

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok || response.status === 404) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for a libSQL server at ${url}`);
}

/** Returned to Playwright as the global teardown. */
function stopServers(): void {
  for (const server of servers) {
    if (server.pid === undefined) continue;
    // Negative pid signals the group, so `sqld` goes with its wrapper.
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  servers.length = 0;
}

export default async function globalSetup(): Promise<() => void> {
  await Promise.all([
    assertPortFree(PORTS.directory),
    assertPortFree(PORTS.user),
    assertPortFree(PORTS.secondUser),
  ]);

  startServer(PORTS.directory);
  startServer(PORTS.user);
  startServer(PORTS.secondUser);

  try {
    await Promise.all([
      waitForServer(DIRECTORY_URL),
      waitForServer(USER_URL),
      waitForServer(SECOND_USER_URL),
    ]);

    // The same migrations the application applies in production, so the tests
    // cannot drift from the schema they are meant to protect. Nothing else
    // creates these tables: `/test/seed` writes a user row directly rather
    // than going through the provisioning that would have migrated for it.
    await applyMigrations({ url: DIRECTORY_URL }, DIRECTORY_MIGRATIONS);
    await applyMigrations({ url: USER_URL }, USER_MIGRATIONS);
    await applyMigrations({ url: SECOND_USER_URL }, USER_MIGRATIONS);
  } catch (error) {
    // A half-started stack must not outlive the failure that stopped it.
    stopServers();
    throw error;
  }

  return stopServers;
}
