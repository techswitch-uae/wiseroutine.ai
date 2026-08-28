import { type ChildProcess, spawn } from "node:child_process";
import {
  applyMigrations,
  DIRECTORY_MIGRATIONS,
  USER_MIGRATIONS,
} from "@wiseroutine/db";
import { DIRECTORY_URL, PORTS, USER_URL } from "./environment";

/**
 * Two libSQL servers that live for exactly one run.
 *
 * Turso is an HTTP service rather than a Worker binding, so the Worker under
 * test needs real endpoints - it cannot be handed a file. `turso dev` serves
 * one database per instance, hence two: one for the directory, one for user
 * data. In memory, so there is nothing left on disk afterwards and nothing to
 * inherit from the run before.
 *
 * What this does *not* isolate is one test user from another: a local server
 * has no concept of multiple databases, so every seeded user resolves to the
 * same user database. That is why `/test/reset` still runs before every
 * scenario. The two-tier split is genuinely exercised - a directory query
 * cannot see user data - but tenant separation is not, and these tests should
 * never be cited as evidence for it.
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
  ]);

  startServer(PORTS.directory);
  startServer(PORTS.user);

  try {
    await Promise.all([waitForServer(DIRECTORY_URL), waitForServer(USER_URL)]);

    // The same migrations the application applies in production, so the tests
    // cannot drift from the schema they are meant to protect. Nothing else
    // creates these tables: `/test/seed` writes a user row directly rather
    // than going through the provisioning that would have migrated for it.
    await applyMigrations({ url: DIRECTORY_URL }, DIRECTORY_MIGRATIONS);
    await applyMigrations({ url: USER_URL }, USER_MIGRATIONS);
  } catch (error) {
    // A half-started stack must not outlive the failure that stopped it.
    stopServers();
    throw error;
  }

  return stopServers;
}
