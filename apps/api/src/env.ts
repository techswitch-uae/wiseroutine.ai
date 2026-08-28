import {
  type Credentials,
  createUserDatabase,
  databaseKeys,
  userDatabaseUrl,
} from "@wiseroutine/db";
import { composeEnv, coreKeys, required, z } from "@wiseroutine/env";
import { providerKeys } from "@wiseroutine/providers";

/**
 * This app's environment, composed from the packages it uses.
 *
 * Each package owns its own fragment, so deleting a package deletes its
 * configuration requirements with it. Only what has no package yet is declared
 * here.
 */
const billingKeys = {
  // Move to `packages/payments/keys.ts` when that package exists - today
  // Stripe is used only by `src/stripe.ts`, and a package holding one file
  // would be ceremony.
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PRO_PRICE_ID: z.string().startsWith("price_").optional(),
};

const emailKeys = {
  // Resend is used only to deliver the sign-in code. Moves to
  // `packages/email/keys.ts` if anything else ever sends mail.
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  /** Must be an address on a domain verified in Resend. */
  RESEND_FROM: z.string().optional(),
};

const notificationKeys = {
  // Likewise, moves to `packages/notifications/keys.ts` when that is built.
  ONESIGNAL_APP_ID: z.string().optional(),
  ONESIGNAL_API_KEY: z.string().optional(),
};

const env = composeEnv({
  ...coreKeys,
  ...databaseKeys,
  ...providerKeys,
  ...billingKeys,
  ...emailKeys,
  ...notificationKeys,
});

export const serverEnvSchema = env.schema;
export type ServerEnv = ReturnType<typeof env.parse>;

/* ── Where the values come from ──────────────────────────────────────────── */

/**
 * The secrets, and the single place their names are written down.
 *
 * Each one is a Cloudflare Secrets Store binding in the deployed environments
 * (`wrangler.jsonc`) and a plain string from `.dev.vars` locally. Both arrive
 * on the same `env` key, so the only difference is whether the value needs
 * awaiting - which is what `resolveServerEnv` normalises away.
 *
 * Anything *not* in this list is a var: public, environment-specific, and
 * committed in `wrangler.jsonc` where it can be read at a glance.
 */
export const SECRET_KEYS = [
  "TURSO_AUTH_TOKEN",
  "TURSO_PLATFORM_TOKEN",
  "TOKEN_ROOT_KEY",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "ONESIGNAL_API_KEY",
] as const;

/** A Secrets Store binding: an object whose value must be awaited. */
interface SecretBinding {
  get(): Promise<string>;
}

const isSecretBinding = (value: unknown): value is SecretBinding =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SecretBinding).get === "function";

/**
 * Resolved once per isolate, not once per request.
 *
 * Reading ten Secrets Store bindings is ten awaits; doing that on every
 * request would put them in front of every route. Keyed on the bindings
 * object itself so a different environment - the test runner's, say - cannot
 * pick up another one's cached answer, and so nothing is retained after the
 * isolate goes away.
 */
const resolved = new WeakMap<object, Promise<ServerEnv>>();

async function resolve(bindings: Record<string, unknown>): Promise<ServerEnv> {
  const raw: Record<string, unknown> = { ...bindings };

  await Promise.all(
    SECRET_KEYS.map(async (key) => {
      const binding = bindings[key];
      if (isSecretBinding(binding)) raw[key] = await binding.get();
    }),
  );

  return env.parse(raw);
}

/**
 * On Workers there is no `process.env`, so this takes the bindings object.
 *
 * Async because a Secrets Store secret is fetched, not injected. That is the
 * trade for having one account-level store as the source of truth: rotating a
 * value there reaches the Worker without a redeploy.
 */
export function resolveServerEnv(
  bindings: Record<string, unknown>,
): Promise<ServerEnv> {
  const hit = resolved.get(bindings);
  if (hit) return hit;

  const pending = resolve(bindings);
  resolved.set(bindings, pending);
  return pending;
}

/**
 * Everything a deployed environment must have.
 *
 * The package fragments mark secrets optional so a half-configured laptop can
 * still boot the parts it is working on. That leniency must not reach a
 * deployment, so this is the second gate: `pnpm deploy:*` calls it through
 * `/health/config` right after uploading, and a failure fails the deploy.
 *
 * It checks presence; the fragments' own rules (a `re_` prefix, 32 bytes of
 * base64, a `whsec_` webhook secret) have already checked shape by the time
 * this runs. Together that is "missing or invalid" - which is as far as it can
 * go, since Cloudflare never lets anything read a stored secret back to
 * compare it against the vault.
 */
export function assertConfigured(config: ServerEnv): void {
  const missing = [
    ...SECRET_KEYS,
    "TURSO_DIRECTORY_URL",
    "TURSO_USER_HOST",
    "TURSO_ORG",
    "TURSO_GROUP",
    "GOOGLE_CLIENT_ID",
    "MICROSOFT_CLIENT_ID",
    "STRIPE_PRO_PRICE_ID",
    "RESEND_FROM",
    "ONESIGNAL_APP_ID",
  ].filter((key) => {
    const value = (config as unknown as Record<string, unknown>)[key];
    return value === undefined || value === null || value === "";
  });

  // A var still holding its scaffold value is not configuration, it is a
  // reminder - and an empty check waves it through. `wrangler.jsonc` ships
  // with a REPLACE_WITH_* for every value that has to be filled in, so the
  // marker is worth failing on explicitly.
  const unfilled = Object.entries(config as unknown as Record<string, unknown>)
    .filter(([, value]) => String(value ?? "").startsWith("REPLACE_WITH"))
    .map(([key]) => key);

  const problems = [
    ...missing.map((key) => `${key} (missing)`),
    ...unfilled.map((key) => `${key} (still a placeholder)`),
  ];

  if (problems.length > 0) {
    throw new Error(`Configuration not ready: ${problems.sort().join(", ")}`);
  }
}

/* ── What the configuration resolves to ──────────────────────────────────── */

/**
 * Turso is reached over HTTP with a URL and a token, so a database is
 * configuration rather than a Worker binding - which is also why it can be
 * opened from anywhere, including a queue consumer or an auth hook.
 */
export function directoryCredentials(env: ServerEnv): Credentials {
  return {
    url: required(env.TURSO_DIRECTORY_URL, "TURSO_DIRECTORY_URL"),
    authToken: env.TURSO_AUTH_TOKEN,
  };
}

export function userCredentials(
  env: ServerEnv,
  databaseName: string,
): Credentials {
  return {
    url: userDatabaseUrl(
      databaseName,
      required(env.TURSO_USER_HOST, "TURSO_USER_HOST"),
    ),
    authToken: env.TURSO_AUTH_TOKEN,
  };
}

/** Open a user's own database. */
export function createUserDb(env: ServerEnv, databaseName: string) {
  return createUserDatabase(userCredentials(env, databaseName));
}
