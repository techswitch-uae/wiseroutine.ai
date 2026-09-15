import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseEnv } from "node:util";

const vars = parseEnv(
  readFileSync(
    new URL("../apps/desktop/e2e/worker.vars", import.meta.url),
    "utf8",
  ),
);
const config = readFileSync(
  new URL("../apps/desktop/playwright.config.ts", import.meta.url),
  "utf8",
);

test("browser fixtures supply valid dummy auth/encryption values without private credentials", () => {
  assert.equal(vars.ENVIRONMENT, "development");
  assert.ok(vars.SESSION_SECRET.startsWith("e2e-only-"));
  assert.ok(vars.SESSION_SECRET.length >= 32);
  assert.equal(Buffer.from(vars.TOKEN_ROOT_KEY, "base64").length, 32);
  for (const key of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
  ]) {
    assert.ok(vars[key].startsWith("e2e-"), `${key} must be a dummy fixture`);
  }
  assert.deepEqual(
    Object.keys(vars).sort(),
    [
      "ENVIRONMENT",
      "SESSION_SECRET",
      "TOKEN_ROOT_KEY",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
    ].sort(),
  );
});

test("the local Worker explicitly loads the fixture rather than developer dotenv files", () => {
  assert.ok(config.includes("--env-file ../desktop/e2e/worker.vars"));
  assert.ok(config.includes("--local --ip 127.0.0.1"));
  assert.match(config, /CLOUDFLARE_ENV:\s*""/);
  assert.match(config, /CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:\s*"true"/);
  assert.match(config, /CLOUDFLARE_INCLUDE_PROCESS_ENV:\s*"false"/);
  assert.match(config, /WRANGLER_LOG_PATH:\s*"\.wrangler\/e2e-logs"/);
  assert.match(config, /WRANGLER_LOG_SANITIZE:\s*"true"/);
  const built = readFileSync(
    new URL("../apps/desktop/playwright.production.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(built, /WRANGLER_LOG_PATH:\s*"\.wrangler\/e2e-built-logs"/);
});
