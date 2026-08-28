import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // `e2e/` belongs to Playwright, which needs a real browser and both
    // servers running. Vitest collecting those specs turns `pnpm test` red
    // for a reason that has nothing to do with the code.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
