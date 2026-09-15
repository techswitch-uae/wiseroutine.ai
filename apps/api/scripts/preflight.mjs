#!/usr/bin/env node
/** Offline declaration check. Never reads .env/.dev.vars or contacts a service. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "jsonc-parser";
import { missing, placeholder, REQUIRED_SECRET_KEYS, SECRET_KEYS, variableProblems } from "../src/deployment.ts";

export const PREFIX = { dev: "WR_DEV_", production: "WR_PROD_" };
export function loadDeployment(environment, source = new URL("../wrangler.jsonc", import.meta.url)) {
  if (!Object.hasOwn(PREFIX, environment)) throw new Error("Choose --env dev or --env production");
  const errors = [];
  const document = parse(readFileSync(source, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error("Invalid wrangler JSONC; refusing deployment");
  const selected = document?.env?.[environment];
  if (!selected || typeof selected !== "object") throw new Error(`No explicit ${environment} deployment configuration`);
  return selected;
}

export function deploymentProblems(selected, environment) {
  const vars = selected.vars ?? {};
  const problems = variableProblems(vars);
  if (vars.ENVIRONMENT !== (environment === "production" ? "production" : "preview")) {
    problems.push("ENVIRONMENT (does not match the selected deployment)");
  }
  const bindings = selected.secrets_store_secrets ?? [];
  const names = new Set();
  const stores = new Set();
  for (const binding of bindings) {
    const name = binding.binding;
    if (names.has(name)) problems.push(`${name} (duplicate secret binding)`);
    names.add(name);
    if (missing(binding.store_id) || placeholder(binding.store_id)) problems.push(`${name}.store_id (missing or placeholder)`);
    stores.add(binding.store_id);
    if (binding.secret_name !== `${PREFIX[environment]}${name}`) problems.push(`${name}.secret_name (wrong environment/name)`);
    if (String(name).startsWith("E2E_")) problems.push(`${name} (test binding in deployment)`);
  }
  if (stores.size !== 1) problems.push("secrets_store_secrets (expected one explicitly selected store)");
  for (const key of REQUIRED_SECRET_KEYS) {
    if (!names.has(key)) problems.push(`${key} (missing secret binding)`);
  }
  for (const key of SECRET_KEYS) {
    if (Object.hasOwn(vars, key)) problems.push(`${key} (secret must not be in vars)`);
  }
  for (const key of Object.keys(vars)) if (key.startsWith("E2E_")) problems.push(`${key} (test binding in deployment)`);
  // Also inspect resource IDs and nested declarations, not only top-level vars.
  const inspect = (value, path) => {
    if (placeholder(value)) problems.push(`${path} (still a placeholder)`);
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) inspect(child, path ? `${path}.${key}` : key);
  };
  inspect(selected, "");
  return [...new Set(problems)].sort();
}
export function checkDeployment(environment, source) {
  const config = loadDeployment(environment, source);
  const problems = deploymentProblems(config, environment);
  if (problems.length) throw new Error(`Deployment preflight failed (${environment}):\n  ${problems.join("\n  ")}`);
  return config;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { env: { type: "string" } }, strict: true });
    checkDeployment(values.env);
    console.log(`[preflight] ${values.env}: declarations valid. Secret values, live services and schema rollout still need verification.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
