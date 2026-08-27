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

const DIRECTORY_PORT = 41080;
const USER_PORT = 41081;

const servers: ChildProcess[] = [];

function startServer(port: number): ChildProcess {
  const child = spawn("turso", ["dev", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    throw new Error(
      `Could not start \`turso dev\` on port ${port}. The Turso CLI is required to run these tests — see SETUP.md. (${error.message})`,
    );
  });
  servers.push(child);
  return child;
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
  for (const server of servers) server.kill();
}
