import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Unit tests live in src/. Browser suites belong to Playwright and need
    // real browsers/servers. An explicit include also keeps future e2e folders
    // from being collected by Vitest accidentally.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "e2e/**",
      "e2e-addons/**",
      "e2e-production/**",
      ".playwright/**",
    ],
  },
});
