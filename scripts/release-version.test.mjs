import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { GenericJson } from "release-please/build/src/updaters/generic-json.js";
import { GenericToml } from "release-please/build/src/updaters/generic-toml.js";
import { Version } from "release-please/build/src/version.js";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("release-please-config.json")).packages["."];
const manifestPath = "apps/desktop/src-tauri/Cargo.toml";
const lockPath = "apps/desktop/src-tauri/Cargo.lock";
const cargoVersion = (text) =>
  text.match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)[1];
const lockVersion = (text) =>
  text.match(/\[\[package\]\]\nname = "wiseroutine"\nversion = "([^"]+)"/)[1];

test("checked-in root, release manifest, Tauri and Rust versions agree", () => {
  const version = JSON.parse(read("package.json")).version;
  assert.equal(JSON.parse(read(".release-please-manifest.json"))["."], version);
  assert.equal(
    JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).version,
    version,
  );
  assert.equal(cargoVersion(read(manifestPath)), version);
  assert.equal(lockVersion(read(lockPath)), version);
});

test("the configured Release Please updaters produce a locked-buildable next version", () => {
  // Exercise the real updaters, not a second implementation of JSONPath/TOML.
  const current = Version.parse(JSON.parse(read("package.json")).version);
  const version = Version.parse(
    `${current.major}.${current.minor}.${current.patch + 1}`,
  );
  const changed = new Map();
  for (const file of config["extra-files"]) {
    const Updater = file.type === "toml" ? GenericToml : GenericJson;
    changed.set(
      file.path,
      new Updater(file.jsonpath, version).updateContent(read(file.path)),
    );
  }
  assert.ok(changed.has(lockPath), "Cargo.lock must be part of the release PR");
  assert.equal(cargoVersion(changed.get(manifestPath)), version.toString());
  assert.equal(lockVersion(changed.get(lockPath)), version.toString());
  assert.equal(
    JSON.parse(changed.get("apps/desktop/src-tauri/tauri.conf.json")).version,
    version.toString(),
  );
  // No dependency version or checksum may change when only this crate bumps.
  assert.equal(
    changed
      .get(lockPath)
      .replace(/(name = "wiseroutine"\nversion = ")[^"]+/, "$1VERSION"),
    read(lockPath).replace(
      /(name = "wiseroutine"\nversion = ")[^"]+/,
      "$1VERSION",
    ),
  );
  const dir = mkdtempSync(join(tmpdir(), "wr-release-version-"));
  try {
    writeFileSync(join(dir, "Cargo.toml"), changed.get(manifestPath));
    writeFileSync(join(dir, "Cargo.lock"), changed.get(lockPath));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/main.rs"), "fn main() {}\n");
    writeFileSync(join(dir, "src/lib.rs"), "");
    const metadata = JSON.parse(
      execFileSync(
        "cargo",
        ["metadata", "--locked", "--no-deps", "--format-version", "1"],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 180_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    assert.equal(
      metadata.packages.find((p) => p.name === "wiseroutine").version,
      version.toString(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
