/** Shared by the Worker health gate and the local, non-network preflight.
 * This validates the currently declared services, not live service operation.
 * Optional-service removal/profile changes require a reviewed deployment change. */
export const SECRET_KEYS = [
  "TURSO_AUTH_TOKEN", "TURSO_PLATFORM_TOKEN", "TOKEN_ROOT_KEY", "SESSION_SECRET",
  "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET", "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "ONESIGNAL_API_KEY",
] as const;
export const DEPLOYMENT_VARS = [
  "APP_URL", "API_URL", "TURSO_DIRECTORY_URL", "TURSO_USER_HOST", "TURSO_ORG", "TURSO_GROUP",
  "GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "STRIPE_PRO_PRICE_ID", "RESEND_FROM", "ONESIGNAL_APP_ID",
] as const;
export const placeholder = (value: unknown): boolean => typeof value === "string" && /REPLACE_WITH/i.test(value);
export const missing = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

export function variableProblems(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const key of DEPLOYMENT_VARS) if (missing(config[key])) problems.push(`${key} (missing)`);
  for (const [key, value] of Object.entries(config)) {
    if (placeholder(value)) problems.push(`${key} (still a placeholder)`);
  }
  for (const key of ["APP_URL", "API_URL", "TURSO_DIRECTORY_URL"] as const) {
    if (missing(config[key]) || placeholder(config[key])) continue;
    try {
      const url = new URL(String(config[key]));
      const protocols = key === "TURSO_DIRECTORY_URL" ? ["libsql:", "https:"] : ["https:"];
      if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "/" && url.pathname !== "") || localHost(url.hostname)) {
        problems.push(`${key} (must be a public secure origin without credentials, path or query)`);
      }
    } catch { problems.push(`${key} (invalid URL)`); }
  }
  const host = config.TURSO_USER_HOST;
  if (!missing(host) && (!/^[a-z0-9][a-z0-9.-]+$/i.test(String(host)) || localHost(String(host)))) {
    problems.push("TURSO_USER_HOST (must be a remote database hostname, not a local URL)");
  }
  return problems;
}
function localHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]" ||
    /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

export function configurationProblems(config: Record<string, unknown>): string[] {
  const problems = variableProblems(config);
  for (const key of SECRET_KEYS) if (missing(config[key])) problems.push(`${key} (missing)`);
  if (config.TOKEN_ROOT_KEY) {
    try { if (atob(String(config.TOKEN_ROOT_KEY)).length !== 32) problems.push("TOKEN_ROOT_KEY (must encode 32 bytes)"); }
    catch { problems.push("TOKEN_ROOT_KEY (invalid base64)"); }
  }
  if (config.ENVIRONMENT === "production" || config.ENVIRONMENT === "preview") {
    for (const key of Object.keys(config)) if (key.startsWith("E2E_") && config[key] !== undefined) problems.push(`${key} (test binding in deployed environment)`);
  }
  return [...new Set(problems)].sort();
}
