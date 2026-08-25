import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Handlers run in workerd — the same runtime as production, with real KV and
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
          // path. Throwaway values — real ones never leave Cloudflare.
          TOKEN_ROOT_KEY: "dGVzdC1yb290LWtleS0zMi1ieXRlcy1sb25nLXh4eHg=",
          SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
          APP_URL: "http://localhost:3000",
          API_URL: "http://localhost:8787",
          TURSO_DIRECTORY_URL: "http://127.0.0.1:8080",
          TURSO_USER_HOST: "http://127.0.0.1:8081",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
  },
});
