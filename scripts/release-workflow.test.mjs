// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expressions, not JavaScript interpolation
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import yaml from "js-yaml";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const release = yaml.load(read(".github/workflows/release.yml"));
const ci = yaml.load(read(".github/workflows/ci.yml"));

test("installers require the entire CI contract at the exact release SHA", () => {
  assert.equal(release.jobs.candidate.uses, "./.github/workflows/ci.yml");
  assert.equal(
    release.jobs.candidate.with.ref,
    "${{ needs.release-please.outputs.sha }}",
  );
  assert.ok(release.jobs.build.needs.includes("candidate"));
  assert.equal(ci.on.workflow_call.inputs.ref.required, true);
  for (const job of Object.values(ci.jobs)) {
    assert.equal(
      job.steps.find((s) => s.uses?.startsWith("actions/checkout@"))?.with.ref,
      "${{ inputs.ref || github.sha }}",
    );
  }
  const commands = Object.values(ci.jobs)
    .flatMap((j) => j.steps.map((s) => s.run ?? ""))
    .join("\n");
  for (const gate of [
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:release",
    "pnpm test:app-browser",
    "pnpm test:app-built",
    "pnpm test:web-browser",
    "cargo test --locked",
  ]) {
    assert.ok(commands.includes(gate), `Missing candidate gate: ${gate}`);
  }
  assert.equal(
    release.jobs.build.steps.find((s) =>
      s.uses?.startsWith("actions/checkout@"),
    ).with.ref,
    "${{ needs.release-please.outputs.sha }}",
  );
});

test("built-app CI installs both engines and retains its actual report paths", () => {
  const steps = ci.jobs.verify.steps;
  assert.ok(
    steps.some((s) => /playwright install.*chromium.*webkit/.test(s.run ?? "")),
  );
  const evidence = steps.find((s) => s.with?.name === "app-browser-results");
  assert.equal(evidence.if, "always()");
  assert.equal(evidence.with["include-hidden-files"], true);
  for (const path of [
    ".playwright/built/report/",
    ".playwright/built/test-results/",
  ]) {
    assert.ok(evidence.with.path.includes(`apps/desktop/${path}`));
  }
  for (const path of ["e2e-logs", "e2e-built-logs"]) {
    assert.ok(evidence.with.path.includes(`apps/api/.wrangler/${path}/`));
  }
});

test("a failed or incomplete candidate never publishes an installer release", () => {
  const config = JSON.parse(read("release-please-config.json")).packages["."];
  assert.equal(config.draft, true);
  assert.equal(config["force-tag-creation"], true);
  const builder = release.jobs.build.steps.find((s) =>
    s.uses?.startsWith("tauri-apps/tauri-action@"),
  );
  assert.equal(builder.with.releaseDraft, true);
  assert.equal(
    builder.with.releaseId,
    "${{ needs.release-please.outputs.id }}",
  );
  assert.equal(release.concurrency["cancel-in-progress"], false);
});
