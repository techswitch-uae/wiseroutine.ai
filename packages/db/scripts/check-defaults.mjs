#!/usr/bin/env node
/**
 * Keep `USER_DEFAULTS` and the Prisma schema agreeing about what a new user
 * starts with.
 *
 * Two places have to know: the schema, which the database enforces on a direct
 * insert, and `USER_DEFAULTS`, which Better Auth writes at signup because it
 * validates its own required-field list before any insert happens. Drift is
 * silent - a new account would simply get the wrong timezone, or the wrong
 * plan.
 *
 * Runs as part of `generate`, which is when the schema changes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Parse a Prisma `@default(...)` back to the value it denotes. */
function parseDefault(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw.replace(/^"(.*)"$/, "$1");
}

function schemaDefaults() {
  const schema = read("prisma/directory.prisma");
  const start = schema.indexOf("model User {");
  const model = schema.slice(start, schema.indexOf("\n}", start));

  const found = new Map();
  for (const line of model.split("\n")) {
    const field = line.match(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s/);
    const def = line.match(/@default\(([^)]*)\)/);
    if (field && def) found.set(field[1], parseDefault(def[1]));
  }
  return found;
}

function declaredDefaults() {
  const source = read("src/directory/users.ts");
  const block = source.match(/USER_DEFAULTS = \{([\s\S]*?)\} as const;/);
  if (!block) {
    console.error("[check-defaults] could not find USER_DEFAULTS");
    process.exit(1);
  }

  const found = new Map();
  for (const m of block[1].matchAll(
    /^\s*([a-zA-Z][a-zA-Z0-9]*):\s*(.+?),\s*$/gm,
  )) {
    found.set(m[1], parseDefault(m[2].trim()));
  }
  return found;
}

const schema = schemaDefaults();
const declared = declaredDefaults();
const problems = [];

if (declared.size === 0) problems.push("USER_DEFAULTS parsed as empty");

for (const [field, value] of declared) {
  if (!schema.has(field)) {
    problems.push(`${field}: no @default in the schema`);
  } else if (schema.get(field) !== value) {
    problems.push(
      `${field}: schema has ${JSON.stringify(schema.get(field))}, USER_DEFAULTS has ${JSON.stringify(value)}`,
    );
  }
}

if (problems.length > 0) {
  console.error("[check-defaults] out of step with prisma/directory.prisma:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`[check-defaults] ${declared.size} user defaults match the schema`);
