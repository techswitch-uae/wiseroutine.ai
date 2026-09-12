import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORE_FEATURES,
  resolveFeatures,
} from "../packages/plans/src/features.ts";
import { changeFlags, main, selection, wranglerArgs } from "./features.mjs";

test("milestones select their own release, not every preceding feature", () => {
  assert.deepEqual(selection("m1"), ["guided_sessions"]);
  const flags = changeFlags({}, "m2", true);
  assert.equal(flags.capture_files, true);
  assert.equal(flags.community_addons, undefined);
  assert.throws(() => selection("typo"));
});
test("enabling a slice includes dependencies; disabling preserves requested configuration", () => {
  const flags = changeFlags({}, "capture_files", true);
  assert.equal(resolveFeatures(flags).capture_files, true);
  const off = changeFlags(flags, "inbox", false);
  assert.equal(off.capture_files, true);
  assert.equal(resolveFeatures(off).capture_files, false);
  assert.deepEqual(
    resolveFeatures(changeFlags(flags, "all", false)),
    CORE_FEATURES,
  );
});
test("environments do not share local and remote namespaces", () => {
  assert.deepEqual(wranglerArgs("local"), ["--local"]);
  assert.deepEqual(wranglerArgs("dev"), ["--env", "dev", "--remote"]);
  assert.throws(() => wranglerArgs("prod"));
});
test("production writes require confirmation before any network work", () => {
  assert.throws(
    () => main(["enable", "m1", "--env", "production"]),
    /Production write refused/,
  );
});
test("misspelled targeting options never accidentally modify everyone", () => {
  assert.throws(
    () => main(["enable", "m1", "--users", "id"]),
    /Unknown option/,
  );
  assert.throws(
    () => main(["enable", "m1", "--env", "local", "--env", "dev"]),
    /Duplicate option/,
  );
  assert.throws(() => main(["enable", "m1", "--user"]), /Missing/);
});
