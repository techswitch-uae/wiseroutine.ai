import { parseArgs } from "node:util";
import {
  loadDeployment,
  PREFIX,
} from "../../../apps/api/scripts/preflight.mjs";

export const HELP = `Usage: pnpm db:migrate --env local|dev|production (--directory | --all-users | --user NAME) [--dry] [--confirm-production]

Run --directory first, then --all-users or --user. User-only runs never write the directory.
--dry reads migration markers and reports pending names without writing schemas.
Remote credentials must be exported as WR_DEV_TURSO_AUTH_TOKEN or WR_PROD_TURSO_AUTH_TOKEN.
No .dev.vars/.env files are loaded. Production writes require --confirm-production.
Local --all-users targets the single shared local user database, even before signup.`;

export function migrationOptions(args) {
  const { values, tokens } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      env: { type: "string" },
      directory: { type: "boolean" },
      "all-users": { type: "boolean" },
      user: { type: "string" },
      dry: { type: "boolean" },
      "confirm-production": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name))
      throw new Error(`Duplicate option --${token.name}`);
    seen.add(token.name);
  }
  if (values.help) {
    if (tokens.length !== 1) throw new Error("Use --help alone");
    return { help: true };
  }
  if (!["local", "dev", "production"].includes(values.env))
    throw new Error("Choose --env local, dev or production explicitly");
  if (
    [values.directory, values["all-users"], values.user !== undefined].filter(
      Boolean,
    ).length !== 1
  ) {
    throw new Error(
      "Choose exactly one scope: --directory, --all-users or --user NAME",
    );
  }
  if (values.user !== undefined) {
    validateDatabaseName(values.user);
    if (values.env === "local")
      throw new Error(
        "Local users share one database; use --all-users, not --user",
      );
  }
  if (values["confirm-production"] && values.env !== "production")
    throw new Error("--confirm-production requires --env production");
  if (
    values.env === "production" &&
    !values.dry &&
    !values["confirm-production"]
  ) {
    throw new Error(
      "Production writes require --confirm-production after backup and dry-run review",
    );
  }
  return {
    environment: values.env,
    scope: values.directory ? "directory" : "users",
    user: values.user,
    dry: Boolean(values.dry),
  };
}

export function validateDatabaseName(name) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
    throw new Error("Invalid user database name");
  return name;
}

function origin(value, key, local) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an explicit database origin`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !value ||
    /REPLACE_WITH/i.test(value) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    (local
      ? !loopback || url.protocol !== "http:"
      : loopback || !["libsql:", "https:"].includes(url.protocol))
  ) {
    throw new Error(
      `${key} must be ${local ? "a loopback HTTP" : "a remote secure"} origin without credentials, paths or placeholders`,
    );
  }
  return value;
}

export function migrationConfig(
  options,
  environment = process.env,
  load = loadDeployment,
) {
  if (options.help) return options;
  if (options.environment === "local") {
    const local = {
      ...options,
      directoryUrl: origin(
        environment.TURSO_DIRECTORY_URL ?? "http://127.0.0.1:41080",
        "TURSO_DIRECTORY_URL",
        true,
      ),
      userHost: origin(
        environment.TURSO_USER_HOST ?? "http://127.0.0.1:41081",
        "TURSO_USER_HOST",
        true,
      ),
      // Never forward a remote/global token to the local server.
      authToken: undefined,
    };
    if (
      (new URL(local.directoryUrl).port || "80") ===
      (new URL(local.userHost).port || "80")
    ) {
      throw new Error(
        "Local directory and user databases must use separate ports",
      );
    }
    return local;
  }
  const vars = load(options.environment).vars ?? {};
  if (
    vars.ENVIRONMENT !==
    (options.environment === "dev" ? "preview" : "production")
  )
    throw new Error("Deployment ENVIRONMENT does not match --env");
  const directoryUrl = origin(
    vars.TURSO_DIRECTORY_URL,
    "TURSO_DIRECTORY_URL",
    false,
  );
  const userHost = vars.TURSO_USER_HOST;
  if (
    typeof userHost !== "string" ||
    !/^[a-z0-9][a-z0-9-]*\.turso\.io$/.test(userHost)
  )
    throw new Error(
      "TURSO_USER_HOST must be the selected Turso organization hostname",
    );
  if (!new URL(directoryUrl).hostname.endsWith(`-${userHost}`))
    throw new Error(
      "Directory and user databases must belong to the same selected Turso organization",
    );
  const key = `${PREFIX[options.environment]}TURSO_AUTH_TOKEN`;
  const authToken = environment[key];
  if (!authToken?.trim())
    throw new Error(
      `Export ${key}; generic TURSO_AUTH_TOKEN and local secret files are not used`,
    );
  return { ...options, directoryUrl, userHost, authToken };
}
