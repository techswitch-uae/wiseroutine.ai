import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configurationProblems, SECRET_KEYS } from "../apps/api/src/deployment.ts";
import { checkDeployment, deploymentProblems, loadDeployment } from "../apps/api/scripts/preflight.mjs";
import { declared } from "../apps/api/scripts/secrets-lib.mjs";
const valid = (environment = "production") => ({
  vars: {
    ENVIRONMENT: environment === "production" ? "production" : "development",
    APP_URL: "https://app.example.com", API_URL: "https://api.example.com",
    TURSO_DIRECTORY_URL: "libsql://directory-org.turso.io", TURSO_USER_HOST: "org.turso.io", TURSO_ORG: "org", TURSO_GROUP: "users",
    GOOGLE_CLIENT_ID: "google", MICROSOFT_CLIENT_ID: "microsoft", STRIPE_PRO_PRICE_ID: "price_live", RESEND_FROM: "support@example.com", ONESIGNAL_APP_ID: "notifications",
  },
  secrets_store_secrets: SECRET_KEYS.map((binding) => ({ binding, store_id: `store-${environment}`, secret_name: `WR_${environment === "production" ? "PROD" : "DEV"}_${binding}` })),
});
test("complete declarations pass; embedded placeholders fail without exposing values", () => {
  const input = valid();
  assert.deepEqual(deploymentProblems(input, "production"), []);
  input.vars.TURSO_DIRECTORY_URL = "libsql://directory-REPLACE_WITH_ORG.turso.io";
  input.vars.SESSION_SECRET = "must-not-be-printed";
  const problems = deploymentProblems(input, "production").join("\n");
  assert.match(problems, /TURSO_DIRECTORY_URL.*placeholder/);
  assert.match(problems, /SESSION_SECRET.*must not be in vars/);
  assert.ok(!problems.includes(input.vars.SESSION_SECRET));
  assert.ok(!problems.includes(input.vars.TURSO_DIRECTORY_URL));
});
test("local targets, cross-environment secrets, test bindings and missing bindings fail closed", () => {
  const input = valid();
  input.vars.API_URL = "https://localhost:8787";
  input.vars.E2E_SECRET = "testing-must-not-ship";
  input.secrets_store_secrets[0].secret_name = "WR_DEV_TURSO_AUTH_TOKEN";
  input.secrets_store_secrets.pop();
  const problems = deploymentProblems(input, "production").join("\n");
  for (const key of ["API_URL", "E2E_SECRET", "TURSO_AUTH_TOKEN", "ONESIGNAL_API_KEY"]) assert.ok(problems.includes(key));
  assert.ok(!problems.includes(input.vars.E2E_SECRET));
});
test("JSONC parsing preserves URLs and selects only the requested environment/store", () => {
  const dir = mkdtempSync(join(tmpdir(), "wr-preflight-"));
  try {
    const file = join(dir, "wrangler.jsonc");
    writeFileSync(file, `// comment\n${JSON.stringify({ env: { dev: valid("dev"), production: valid() } }).replace(/}$/, ",}")}`);
    assert.equal(checkDeployment("production", file).vars.API_URL, "https://api.example.com");
    assert.equal(declared("production", file).storeId, "store-production");
    assert.equal(declared("dev", file).storeId, "store-dev");
    assert.throws(() => loadDeployment("prod", file), /Choose --env/);
    writeFileSync(file, '{"env": ');
    assert.throws(() => loadDeployment("production", file), /Invalid wrangler JSONC/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("the Worker checks the same placeholder/transport contract and root-key length", () => {
  const config = { ...valid().vars, ...Object.fromEntries(SECRET_KEYS.map((key) => [key, "present"])), TOKEN_ROOT_KEY: Buffer.alloc(32).toString("base64") };
  assert.deepEqual(configurationProblems(config), []);
  config.TOKEN_ROOT_KEY = Buffer.alloc(16).toString("base64");
  assert.ok(configurationProblems(config).some((p) => p.includes("32 bytes")));
  config.TURSO_DIRECTORY_URL = "libsql://directory-REPLACE_WITH_ORG.turso.io";
  assert.ok(configurationProblems(config).some((p) => p.includes("placeholder")));
});
test("deploy commands preflight before network work and regenerate/check before upload", () => {
  const pkg = JSON.parse(readFileSync(new URL("../apps/api/package.json", import.meta.url), "utf8"));
  for (const environment of ["dev", "prod"]) {
    const command = pkg.scripts[`deploy:${environment}`];
    const steps = ["preflight:", "check-secrets.mjs", "@wiseroutine/db generate", "pnpm typecheck", "wrangler deploy", "/health/config"];
    assert.ok(steps.every((step, n) => command.indexOf(step) >= 0 && (!n || command.indexOf(step) > command.indexOf(steps[n - 1]))));
  }
});
