import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-addons",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4177", headless: true },
  webServer: {
    command: "node e2e-addons/serve.mjs",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
