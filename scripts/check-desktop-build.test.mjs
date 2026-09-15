import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkDesktopBuild } from "./check-desktop-build.mjs";

const shell =
  '<html><head><link rel="stylesheet" href="/assets/app.css"><link rel="modulepreload" href="/assets/route.js"></head><body><script type="module" src="/assets/app.js"></script></body></html>';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "wr-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), shell);
  for (const name of ["app.js", "route.js", "app.css"])
    writeFileSync(join(root, "assets", name), "/* asset */");
  return root;
}
test("complete static output passes; missing and empty entry assets fail", (t) => {
  const root = fixture(t);
  assert.doesNotThrow(() => checkDesktopBuild(root));
  for (const name of [
    "index.html",
    "assets/app.js",
    "assets/route.js",
    "assets/app.css",
  ]) {
    const file = join(root, name);
    const original = readFileSync(file);
    writeFileSync(file, "");
    assert.throws(() => checkDesktopBuild(root));
    rmSync(file);
    assert.throws(() => checkDesktopBuild(root));
    writeFileSync(file, original);
  }
});
test("HTML without a local module entry cannot pass as a usable app", (t) => {
  const root = fixture(t);
  for (const html of [
    "prerender failed",
    "<html></html>",
    shell.replace("/assets/app.js", "https://example.com/app.js"),
    shell.replace("/assets/app.js", "../outside.js"),
  ]) {
    writeFileSync(join(root, "index.html"), html);
    assert.throws(() => checkDesktopBuild(root));
  }
});
test("the post-build CLI exits nonzero when a nominally successful prerender produced no shell", (t) => {
  const root = fixture(t);
  const run = () =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./check-desktop-build.mjs", import.meta.url)),
        root,
      ],
      { encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  rmSync(join(root, "index.html"));
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /desktop-build.*index.html/);
});
test("normal desktop builds clean stale output before Vite and check output afterwards", () => {
  const pkg = JSON.parse(
    readFileSync(
      new URL("../apps/desktop/package.json", import.meta.url),
      "utf8",
    ),
  );
  const commands = pkg.scripts.build.split(" && ");
  assert.equal(
    commands[0],
    "node ../../scripts/check-desktop-build.mjs --clean",
  );
  assert.ok(commands.includes("vite build"));
  assert.equal(commands.at(-1), "node ../../scripts/check-desktop-build.mjs");
});
