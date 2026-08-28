import { defineConfig, devices } from "@playwright/test";

/**
 * Scenario tests, against the real thing.
 *
 * Deliberately not a second unit-test layer. These drive a real browser
 * against the real Vite app and the real Worker, and the Worker is talking to
 * real libSQL — which is the whole point, because the bugs this layer is here
 * to catch have all lived in the seams. A calendar's events surviving a
 * deselect was a Prisma `where` clause; the day not refreshing after connecting
 * an account was a missing event listener. Neither is reachable from a test
 * that mocks the API, and both are obvious from three clicks.
 *
 * That makes them slow and few by design. When a rule can be stated without a
 * browser — how a draft of ticks behaves, how a download reports progress — it
 * belongs in Vitest next to the code, not here.
 *
 * Both servers have to be up: `pnpm dev` (or `dev:vite`) on 41000 and
 * `pnpm api` on 8787, with `E2E_SECRET` set for the Worker. Playwright does
 * not start them, because they are the same two processes you already have
 * running while working — starting a second copy would just fight for ports.
 */
export default defineConfig({
  testDir: "./e2e",
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
    baseURL: process.env.E2E_APP_URL ?? "http://localhost:41000",
    // Kept only for a failure — a passing scenario's trace is noise nobody
    // opens.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
