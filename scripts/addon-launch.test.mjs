import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contract } from "../packages/addon-tools/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("trusted promotion signs bytes without executing submitted code and refuses mismatches/overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-approval-test-"));
  try {
    const artifact = join(dir, "artifact");
    await mkdir(artifact);
    const sentinel = join(dir, "executed");
    const bundle = `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "BAD");`;
    const manifest = contract.parseManifest({
      id: "example.test",
      name: "Test",
      version: "1.0.0",
      description: "Test",
      capabilities: [],
    });
    const payload = {
      format: 1,
      id: manifest.id,
      version: manifest.version,
      manifest,
      bundleHash: createHash("sha256").update(bundle).digest("hex"),
      author: "Example",
      license: "MIT",
      source: {
        repository: "https://github.com/example/test",
        commit: "a".repeat(40),
      },
    };
    await writeFile(join(artifact, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(artifact, "payload.json"), JSON.stringify(payload));
    await writeFile(join(artifact, "addon.js"), bundle);
    await writeFile(join(artifact, "LICENSE"), "MIT test fixture only");
    await writeFile(
      join(artifact, "submission.json"),
      JSON.stringify({
        author: payload.author,
        license: payload.license,
        source: payload.source,
        support: "https://github.com/example/test/issues",
        privacy: "Synthetic test; no personal data",
      }),
    );
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const keyFile = join(dir, "private.pem");
    await writeFile(
      keyFile,
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    const output = join(dir, "approval.json");
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/approve-addon.mjs", artifact, output],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            ADDON_APPROVAL_KEY_FILE: keyFile,
            ADDON_APPROVAL_KEY_ID: "ephemeral-test",
          },
        },
      );
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const approval = JSON.parse(await readFile(output, "utf8"));
    assert.equal(
      await contract.verifyRelease(approval, {
        "ephemeral-test": pair.publicKey.export({ format: "jwk" }),
      }),
      true,
    );
    await assert.rejects(access(sentinel));
    assert.notEqual(run().status, 0);
    await rm(output);
    await writeFile(join(artifact, "addon.js"), "tampered");
    assert.notEqual(run().status, 0);
    await assert.rejects(access(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("kit export excludes private app/backend/root lockfile and refuses overwriting a tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wr-export-test-"));
  const out = join(dir, "kit");
  try {
    const run = () =>
      spawnSync(process.execPath, ["scripts/export-addon-kit.mjs", out], {
        cwd: root,
        encoding: "utf8",
      });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    for (const forbidden of ["apps", ".git", "packages/db", "packages/env"])
      await assert.rejects(access(join(out, forbidden)));
    for (const needed of [
      "README.md",
      "LICENSE",
      "SPEC.md",
      "SECURITY.md",
      "SUBMISSIONS.md",
      "packages/addon-tools/bin/wr-addon.mjs",
      "packages/addon-sdk/src/index.ts",
      "addons/breathing/LICENSE",
    ])
      await access(join(out, needed));
    const publicLock = await readFile(join(out, "pnpm-lock.yaml"), "utf8");
    for (const forbidden of [
      "apps/api:",
      "apps/desktop:",
      "@wiseroutine/db",
      "@wiseroutine/env",
      "wrangler@",
    ])
      assert.equal(publicLock.includes(forbidden), false);
    assert.match(publicLock, /packages\/addon-sdk:/);
    assert.notEqual(run().status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
