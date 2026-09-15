#!/usr/bin/env node
/** Operator-only release controls. Uses Wrangler credentials, never an in-app
 * admin endpoint, browser override, or committed environment-specific secret. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEATURE_CONFIG_KEY,
  FEATURE_KEYS,
  FEATURES,
  featureUserKey,
  isFeature,
  parseFeatureOverrides,
  resolveFeatures,
} from "../packages/plans/src/features.ts";

export function selection(name) {
  if (name === "all") return [...FEATURE_KEYS];
  if (isFeature(name)) return [name];
  const keys = FEATURE_KEYS.filter((key) => FEATURES[key].milestone === name);
  if (!keys.length) throw new Error(`Unknown feature/milestone: ${name}`);
  return keys;
}
export function changeFlags(current, target, enabled) {
  const result = { ...current };
  const set = (key) => {
    if (enabled) for (const dep of FEATURES[key].requires) set(dep);
    result[key] = enabled;
  };
  for (const key of selection(target)) set(key);
  return result;
}
function option(args, key, fallback) {
  const i = args.indexOf(key);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(`Missing ${key} value`);
  return args[i + 1];
}
export function wranglerArgs(environment) {
  if (!["local", "dev", "production"].includes(environment))
    throw new Error("--env must be local, dev, or production");
  return environment === "local"
    ? ["--local"]
    : ["--env", environment, "--remote"];
}
const HELP = `Release feature flags (all off by default)

pnpm features show --env local
pnpm features enable m1 --env local
pnpm features enable quick_capture --env local
pnpm features disable all --env local
pnpm features enable m3 --env dev --user USER_ID
pnpm features reset --env dev --user USER_ID

Targets: ${FEATURE_KEYS.join(", ")}, m1–m6, all
Enable includes dependencies, NOT previous milestones or Pro entitlement.
Disable blocks dependent features without discarding their requested settings.
Reset removes this scope's overrides (an account then inherits global flags).
Local writes share apps/api/.wrangler state with pnpm api.
Production writes require --confirm-production. --dry-run prints without writing.
KV propagation is eventually consistent; restart/reload or wait for the app poll.
`;
export function main(args) {
  if (!args.length || args.includes("--help")) {
    console.log(HELP);
    return;
  }
  const action = args[0];
  if (!["show", "enable", "disable", "reset"].includes(action))
    throw new Error("Expected show, enable, disable, or reset");
  const seen = new Set();
  for (
    let i = ["enable", "disable"].includes(action) ? 2 : 1;
    i < args.length;
    i++
  ) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (["--env", "--user"].includes(key)) {
      option(args, key);
      i++;
    } else if (!["--dry-run", "--confirm-production"].includes(key))
      throw new Error(`Unknown option: ${key}`);
  }
  const environment = option(args, "--env", "local");
  const user = option(args, "--user", null);
  const scope = wranglerArgs(environment);
  const dryRun = args.includes("--dry-run");
  if (
    action !== "show" &&
    environment === "production" &&
    !dryRun &&
    !args.includes("--confirm-production")
  )
    throw new Error(
      "Production write refused. Add --confirm-production after checking --env and --user.",
    );
  if (user && !/^[A-Za-z0-9_-]{1,128}$/.test(user))
    throw new Error("Use the exact account ID, not an email address");
  if (["enable", "disable"].includes(action)) selection(args[1]);
  const key = user ? featureUserKey(user) : FEATURE_CONFIG_KEY;
  const run = (command) => {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "kv",
        "key",
        ...command,
        "--binding",
        "CONFIG",
        ...scope,
      ],
      {
        cwd: fileURLToPath(new URL("../apps/api", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(result.stderr || result.stdout || "Wrangler failed");
    return result.stdout.trim();
  };
  const read = (key) => {
    const text = run(["get", key, "--text"]);
    if (!text || text === "Value not found") return {};
    return parseFeatureOverrides(JSON.parse(text));
  };
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          environment,
          key,
          action,
          target: args[1],
          changes:
            action === "reset"
              ? "delete overrides"
              : ["enable", "disable"].includes(action)
                ? changeFlags({}, args[1], action === "enable")
                : "read only",
        },
        null,
        2,
      ),
    );
    return;
  }
  const global = read(FEATURE_CONFIG_KEY);
  const current = user ? read(key) : global;
  if (action === "reset") run(["delete", key]);
  else if (action !== "show") {
    const next = changeFlags(current, args[1], action === "enable");
    run(["put", key, JSON.stringify(next)]);
  }
  const next =
    action === "reset"
      ? {}
      : action === "show"
        ? current
        : changeFlags(current, args[1], action === "enable");
  console.log(
    JSON.stringify(
      {
        environment,
        scope: user ?? "everyone",
        requested: next,
        effective: user ? resolveFeatures(global, next) : resolveFeatures(next),
      },
      null,
      2,
    ),
  );
  if (action !== "show")
    console.log(
      "Saved. Account overrides may still differ; use show --user ID to check. Existing Pro entitlement is unchanged.",
    );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
