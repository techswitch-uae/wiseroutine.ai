import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Handlers run in workerd - the same runtime as production, with real KV and
 * Queue bindings. The database is Turso over HTTP, so it is configuration
 * rather than a binding, and `vitest.globalSetup.ts` starts two local libSQL
 * servers for the run.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Plain strings, the same way `.dev.vars` supplies them locally.
          // Deployed environments bind these from the Secrets Store instead;
          // `resolveServerEnv` accepts either, so this exercises the real
          // path. Throwaway values - real ones never leave Cloudflare.
          TOKEN_ROOT_KEY: "dGVzdC1yb290LWtleS0zMi1ieXRlcy1sb25nLXh4eHg=",
          SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
          APP_URL: "http://localhost:41000",
          API_URL: "http://localhost:8787",
          TURSO_DIRECTORY_URL: "http://127.0.0.1:41090",
          TURSO_USER_HOST: "http://127.0.0.1:41091",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
    /**
     * One file at a time.
     *
     * `turso dev` serves one database per instance, so every test file shares
     * the same pair - and each one that touches them empties them first (see
     * `resetDatabases`). Two running at once delete each other's users, which
     * surfaces as "Failed to get session" in whichever lost the race.
     *
     * This was true all along and cost nothing while `api.test.ts` was the
     * only file to open a database; the second one to do it is what made the
     * constraint show. The suite runs in seconds either way.
     */
    fileParallelism: false,
  },
});
