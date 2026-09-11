import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { releaseConfig } from "./release-config.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const config = json("../apps/desktop/src-tauri/tauri.conf.json");
const env = { VITE_API_URL: "https://api.wiseroutine.ai", TAURI_SIGNING_PUBLIC_KEY: Buffer.from("untrusted comment: test key\nRWtestfixture").toString("base64"), TAURI_SIGNING_PRIVATE_KEY: "test-only" };
for (const value of [undefined, "http://localhost:8787", "http://api.wiseroutine.ai", "https://attacker.example", "https://api.wiseroutine.ai/path", "https://user:secret@api.wiseroutine.ai"]) {
  test(`release rejects an unsafe/missing API URL: ${value}`, () => assert.throws(() => releaseConfig({ ...env, VITE_API_URL: value }, config)));
}
test("release refuses missing signing material", () => {
  for (const key of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PUBLIC_KEY"]) assert.throws(() => releaseConfig({ ...env, [key]: "" }, config));
  assert.throws(() => releaseConfig({ ...env, TAURI_SIGNING_PUBLIC_KEY: "garbage" }, config));
});
test("only the public key is written to the configuration overlay", () => {
  assert.deepEqual(releaseConfig(env, config), { plugins: { updater: { pubkey: env.TAURI_SIGNING_PUBLIC_KEY } } });
});
test("installer frontend builds through the checked dependency graph", () => {
  assert.equal(config.build.beforeBuildCommand, "pnpm -w release:frontend");
  const desktop = json("../apps/desktop/package.json");
  for (const name of ["breathing", "day-so-far", "deep-work", "eye-rest", "stretch", "todos"]) {
    assert.equal(desktop.devDependencies[`@wiseroutine/addon-${name}`], "workspace:*");
    assert.match(readFileSync(new URL(`../addons/${name}/vite.config.ts`, import.meta.url), "utf8"), /"dist"/);
  }
  assert.ok(json("../turbo.json").tasks.build.env.includes("VITE_API_URL"));
});
