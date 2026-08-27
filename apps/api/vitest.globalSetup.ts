import { type ChildProcess, spawn } from "node:child_process";
import {
  applyMigrations,
  DIRECTORY_MIGRATIONS,
  USER_MIGRATIONS,
} from "@wiseroutine/db";

/**
 * Two local libSQL servers for the test run.
 *
 * Turso is an HTTP service, not a Worker binding, so tests inside workerd
 * cannot open a local file — they need a real endpoint. `turso dev` serves
 * exactly one database per instance, so we start two: one standing in for the
 * directory, one for user data.
 *
 * That means every test "user" shares a single user database. The two-tier
 * split is genuinely exercised — a query against the directory cannot see user
 * data and vice versa — but isolation *between* users is not, since a local
 * server has no concept of multiple databases. Worth knowing before relying on
 * these tests to prove tenant separation.
 */

// Deliberately not the 41080/41081 that `pnpm api` uses. These servers are
// in-memory, so a run that reached a file-backed dev server instead would both
// see leftover state and write test junk into it.
const DIRECTORY_PORT = 41090;
const USER_PORT = 41091;

const servers: ChildProcess[] = [];

/**
 * `turso dev` is a wrapper: it spawns the `sqld` that actually holds the port.
 * Killing the wrapper leaves `sqld` orphaned and still listening, so the next
 * run finds the port taken, fails to bind, and talks to the previous run's
 * database instead. `detached` puts the pair in their own process group, which
 * teardown can then signal as a whole.
 */
function startServer(port: number): ChildProcess {
  const child = spawn("turso", ["dev", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.on("error", (error) => {
    throw new Error(
      `Could not start \`turso dev\` on port ${port}. The Turso CLI is required to run these tests — see SETUP.md. (${error.message})`,
    );
  });
  servers.push(child);
  return child;
}

/**
 * Refuse to run against a server we did not start.
 *
 * `turso dev` binds `*:PORT` while most servers bind `127.0.0.1:PORT`, and the
 * specific bind wins — so when something already holds the port, the spawn
 * fails quietly, `waitForServer` succeeds against the *other* process, and the
 * whole suite runs on someone else's database. Checking first turns that into
 * an error instead of a wrong answer.
 */
async function assertPortFree(port: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
  } catch {
    return; // Nothing listening, which is what we want.
  }
  throw new Error(
    `Something is already listening on 127.0.0.1:${port}. The test suite needs ` +
      `ports ${DIRECTORY_PORT} and ${USER_PORT} to itself — see docs/setup-database.md. ` +
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

export async function setup(): Promise<void> {
  await Promise.all([
    assertPortFree(DIRECTORY_PORT),
    assertPortFree(USER_PORT),
  ]);

  startServer(DIRECTORY_PORT);
  startServer(USER_PORT);

  const directoryUrl = `http://127.0.0.1:${DIRECTORY_PORT}`;
  const userUrl = `http://127.0.0.1:${USER_PORT}`;

  await Promise.all([waitForServer(directoryUrl), waitForServer(userUrl)]);

  // The same migrations the application applies in production, so the tests
  // cannot drift from the schema they are meant to protect.
  await applyMigrations({ url: directoryUrl }, DIRECTORY_MIGRATIONS);
  await applyMigrations({ url: userUrl }, USER_MIGRATIONS);
}

export async function teardown(): Promise<void> {
  for (const server of servers) {
    if (server.pid === undefined) continue;
    // Negative pid signals the group, so `sqld` goes with its wrapper.
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}
