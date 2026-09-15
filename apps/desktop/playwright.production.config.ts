import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
import { API_URL, APP_URL, PORTS } from "./e2e/environment";

const servers = Array.isArray(base.webServer) ? base.webServer : [];
const worker = servers[0];
if (!worker) throw new Error("Missing isolated Worker configuration");
const contracts = ["authentication", "core-release", "calendar-repair", "late-start", "rollover-setup", "session-boundaries", "session-integrity", "slot-actions"];
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["**/e2e-production/*.spec.ts", ...contracts.map((name) => `**/e2e/${name}.spec.ts`)],
  testIgnore: ["**/.playwright/**", "**/node_modules/**", "**/.output/**"],
  outputDir: "test-results-built",
  reporter: [[process.env.CI ? "list" : "line"], ["html", { open: "never", outputFolder: "playwright-report-built" }]],
  webServer: [
    { ...worker, command: worker.command.replace(".wrangler/e2e-state", ".wrangler/e2e-built-state") },
    {
      command: "pnpm exec turbo run build --filter=@wiseroutine/desktop... && node e2e/serve-built.mjs",
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_URL: API_URL, PORT: String(PORTS.app) },
      stdout: "pipe", stderr: "pipe",
    },
  ],
  projects: [
    { name: "built-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "built-webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
