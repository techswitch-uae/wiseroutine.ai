import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import yaml from "js-yaml";
const script = fileURLToPath(new URL("install-turso-ci.sh", import.meta.url));

for (const fail of [false, true]) {
  test(`formula-scoped trust precedes install; trust failure=${fail}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "wr-brew-test-"));
    try {
      writeFileSync(join(dir, "brew"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$BREW_LOG"\nif [[ "$*" == "trust --formula libsql/sqld/sqld" && "$FAIL_TRUST" == "true" ]]; then exit 7; fi\n', { mode: 0o755 });
      const result = spawnSync("bash", [script], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BREW_LOG: join(dir, "calls"), FAIL_TRUST: String(fail) } });
      assert.equal(result.status, fail ? 7 : 0);
      assert.deepEqual(readFileSync(join(dir, "calls"), "utf8").trim().split("\n"), [
        "tap tursodatabase/tap", "tap libsql/sqld", "trust --formula tursodatabase/tap/turso", "trust --formula libsql/sqld/sqld",
        ...(!fail ? ["install tursodatabase/tap/turso"] : []),
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
test("CI and release use the same installer without disabling tap trust", () => {
  for (const workflow of ["ci", "release"]) {
    const text = readFileSync(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), "utf8");
    assert.ok(yaml.load(text).jobs.verify.steps.some((s) => s.run === "bash scripts/install-turso-ci.sh"));
    assert.ok(!text.includes("HOMEBREW_NO_REQUIRE_TAP_TRUST"));
  }
});
