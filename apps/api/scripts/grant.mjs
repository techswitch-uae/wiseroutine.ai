#!/usr/bin/env node
/**
 * Give someone Pro without a card.
 *
 *   pnpm --filter @wiseroutine/api grant founding you@example.com 365
 *   pnpm --filter @wiseroutine/api grant founding --file beta-emails.txt 365
 *   pnpm --filter @wiseroutine/api grant comped you@example.com
 *
 * A script rather than an admin route, deliberately. Founding access is issued
 * a hundred times at the start of a beta and then almost never; an endpoint
 * that can hand out paid plans would be a permanent attack surface bought for
 * a job that runs a handful of times, from a laptop, by the one person who
 * already has the database credentials.
 *
 * Nothing here is special-cased. `grantPlan` is the same function the signup
 * hook calls to issue a trial - a founding grant is that row with a longer
 * expiry and a different `reason`, which is what makes winding the beta down a
 * date passing rather than a flag being flipped. Omit the days for a grant
 * that never expires.
 *
 * Reads `TURSO_DIRECTORY_URL` and `TURSO_DIRECTORY_TOKEN` from the environment
 * or from `apps/api/.dev.vars`, so pointing it at production is an explicit
 * act rather than a default.
 */

import { readFileSync } from "node:fs";
import { createDirectory, grantPlan } from "@wiseroutine/db";

const USAGE = `Usage:
  grant <reason> <email> [days]
  grant <reason> --file <path> [days]

  reason  Why, recorded on the row: "founding", "comped", "support".
  days    Omit for a grant with no end.`;

function envFromDevVars() {
  try {
    const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const found = {};
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      if (match) found[match[1]] = match[2];
    }
    return found;
  } catch {
    // No local file is normal when the credentials are already exported.
    return {};
  }
}

const [reason, target, daysArg] = process.argv.slice(2);
if (!reason || !target) {
  console.error(USAGE);
  process.exit(1);
}

const emails =
  target === "--file"
    ? readFileSync(daysArg ?? "", "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    : [target];

// With `--file` the days argument has been consumed by the path, so it moves
// along one. Explicit rather than clever: the alternative is a flag parser for
// a script with two shapes.
const days = Number(target === "--file" ? process.argv[5] : daysArg);
const expiresAt =
  Number.isFinite(days) && days > 0 ? Date.now() + days * 86_400_000 : null;

const fallback = envFromDevVars();
const url = process.env.TURSO_DIRECTORY_URL ?? fallback.TURSO_DIRECTORY_URL;
const authToken =
  process.env.TURSO_DIRECTORY_TOKEN ?? fallback.TURSO_DIRECTORY_TOKEN;

if (!url) {
  console.error("TURSO_DIRECTORY_URL is not set, and .dev.vars has no copy.");
  process.exit(1);
}

console.log(
  `${url}\n${emails.length} account(s) → pro, reason "${reason}", ${
    expiresAt
      ? `until ${new Date(expiresAt).toISOString().slice(0, 10)}`
      : "no end date"
  }\n`,
);

const directory = createDirectory({ url, ...(authToken ? { authToken } : {}) });
let granted = 0;

for (const email of emails) {
  const user = await directory.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });

  // Named rather than counted. Someone who has not signed up yet is the most
  // likely reason a beta list comes up short, and a bare total would send the
  // operator looking for a bug instead of an unregistered address.
  if (!user) {
    console.log(`  skip  ${email} — no account`);
    continue;
  }

  const state = await grantPlan(
    directory,
    { userId: user.id, plan: "pro", reason, grantedBy: "script", expiresAt },
    Date.now(),
    () => crypto.randomUUID(),
  );
  granted += 1;
  console.log(`  ok    ${email} — ${state.plan} via ${state.source}`);
}

console.log(`\n${granted} of ${emails.length} granted.`);
