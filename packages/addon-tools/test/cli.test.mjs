import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { preview } from "../lib/preview.mjs";
import {
  releasePayload,
  validateDirectory,
  validateManifest,
} from "../lib/validate.mjs";

const manifest = {
  id: "example.hello",
  name: "Hello",
  version: "1.0.0",
  description: "A synthetic fixture",
  capabilities: [{ kind: "ui:widget" }],
  widgets: [{ key: "hello", name: "Hello" }],
};
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "wr-addon-tools-"));
  try {
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(
      join(directory, "dist/addon.js"),
      "console.log('synthetic')",
    );
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("standalone validation binds the actual code digest and source metadata", () =>
  fixture(async (directory) => {
    const build = await validateDirectory(directory);
    assert.match(build.bundleHash, /^[a-f0-9]{64}$/);
    const metadata = {
      author: "Example",
      license: "MIT",
      source: {
        repository: "https://github.com/example/hello",
        commit: "a".repeat(40),
      },
      privacy: "No personal data",
      support: "https://github.com/example/hello/issues",
    };
    assert.equal(releasePayload(build, metadata).bundleHash, build.bundleHash);
    assert.throws(() =>
      releasePayload(build, {
        ...metadata,
        source: { ...metadata.source, commit: "main" },
      }),
    );
    await writeFile(join(directory, "dist/addon.js"), "changed");
    assert.notEqual(
      (await validateDirectory(directory)).bundleHash,
      build.bundleHash,
    );
  }));
test("schema and semantic validation agree on known incompatibilities", () => {
  assert.throws(() =>
    validateManifest({
      ...manifest,
      widgets: [
        { key: "same", name: "A" },
        { key: "same", name: "B" },
      ],
    }),
  );
  assert.throws(() => validateManifest({ ...manifest, apiVersion: 2 }));
  assert.throws(() =>
    validateManifest({
      ...manifest,
      capabilities: [{ kind: "ui:session" }],
      widgets: [],
      activityTypes: [
        {
          key: "a",
          name: "A",
          blurb: "A",
          defaults: { sessionMinutes: 2, startPolicy: "manual" },
          settings: [{ type: "secret", key: "key", label: "Key" }],
        },
      ],
    }),
  );
  assert.throws(() =>
    validateManifest(
      {
        ...manifest,
        capabilities: [
          { kind: "net:fetch", origins: ["https://example.com?x"] },
        ],
      },
      false,
    ),
  );
  assert.throws(() =>
    validateManifest({
      ...manifest,
      capabilities: [{ kind: "net:fetch", origins: ["https://example.com"] }],
    }),
  );
  assert.throws(() => validateManifest({ ...manifest, version: "latest" }));
});
test("preview is loopback-only, rejects path traversal and emits the restrictive frame policy", () =>
  fixture(async (directory) => {
    const server = await preview(directory, 0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal(server.address().address, "127.0.0.1");
      assert.equal((await fetch(`${base}/manifest.json`)).status, 200);
      const frame = await fetch(`${base}/frame`);
      assert.equal(frame.status, 200);
      assert.match(
        frame.headers.get("content-security-policy"),
        /sandbox allow-scripts/,
      );
      assert.match(
        frame.headers.get("content-security-policy"),
        /connect-src 'none'/,
      );
      assert.equal((await fetch(`${base}/..%2f..%2f.env`)).status, 404);
      assert.equal(
        (await fetch(`${base}/manifest.json`, { method: "POST" })).status,
        403,
      );
      const rebound = await new Promise((resolve, reject) => {
        get(base, { headers: { host: "attacker.example" } }, (response) => {
          response.resume();
          resolve(response.statusCode);
        }).once("error", reject);
      });
      assert.equal(rebound, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }));
test("oversize and symlink bundles are refused", () =>
  fixture(async (directory) => {
    const file = join(directory, "dist/addon.js");
    await writeFile(file, "x".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(validateDirectory(directory), /exceeds/);
    await rm(file);
    await symlink(join(directory, "manifest.json"), file);
    await assert.rejects(validateDirectory(directory), /regular file/);
  }));
