import { defineConfig, devices } from "@playwright/test";
import {
  APP_URL,
  DIRECTORY_URL,
  E2E_SECRET,
  PORTS,
  USER_URL,
} from "./e2e/environment";

/**
 * Scenario tests, against the real thing.
 *
 * Deliberately not a second unit-test layer. These drive a real browser
 * against the real Vite app and the real Worker, and the Worker is talking to
 * real libSQL - which is the whole point, because the bugs this layer is here
 * to catch have all lived in the seams. A calendar's events surviving a
 * deselect was a Prisma `where` clause; the day not refreshing after connecting
 * an account was a missing event listener. Neither is reachable from a test
 * that mocks the API, and both are obvious from three clicks.
 *
 * That makes them slow and few by design. When a rule can be stated without a
 * browser - how a draft of ticks behaves, how a download reports progress - it
 * belongs in Vitest next to the code, not here.
 *
 * The whole stack belongs to the run: two libSQL servers from `globalSetup`,
 * and a Worker and a Vite server started below, all on the suite's own ports.
 * They used to be the two processes the developer already had running, which
 * was cheaper to start and cost far more than it saved - see `environment.ts`
 * for the three separate ways that leaked into a working machine. Nothing here
 * touches `.turso-local`, port 8787 or port 41000.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/globalSetup.ts",
  // One at a time: every scenario seeds into the same local libSQL, which
  // serves one database for all users. Parallel runs would read each other's
  // meetings.
  workers: 1,
  fullyParallel: false,
  // A scenario waits on a real sync settling, so the default 5s is too tight.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: APP_URL,
    // Kept only for a failure - a passing scenario's trace is noise nobody
    // opens.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  /**
   * The application under test, pointed at the run's own databases.
   *
   * `reuseExistingServer` is off in every environment, including locally. The
   * whole point of these ports is that nothing else is on them - attaching to
   * a server someone else started would mean attaching to their database too,
   * silently, which is the failure this configuration was rewritten to remove.
   *
   * The Worker's Turso URLs are overridden on the command line rather than in
   * `wrangler.jsonc`, so the file keeps naming the servers `pnpm api` uses and
   * only this run points somewhere else.
   */
  webServer: [
    {
      command:
        `pnpm --filter @wiseroutine/api exec wrangler dev --port ${PORTS.api}` +
        ` --var TURSO_DIRECTORY_URL:${DIRECTORY_URL}` +
        ` --var TURSO_USER_HOST:${USER_URL}` +
        ` --var E2E_SECRET:${E2E_SECRET}`,
      // `/health` answers without touching a database, which is what makes it
      // a readiness check rather than a second thing that has to be up.
      url: `http://localhost:${PORTS.api}/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // `VITE_API_URL` is read at transform time, so the app can only be
      // pointed at this Worker by starting the server with it set.
      command: `pnpm --filter @wiseroutine/desktop exec vite dev --port ${PORTS.app} --strictPort`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { VITE_API_URL: `http://localhost:${PORTS.api}` },
    },
  ],

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
