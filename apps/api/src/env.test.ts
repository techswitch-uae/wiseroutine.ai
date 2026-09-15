import { expect, test, vi } from "vitest";
import { REQUIRED_SECRET_KEYS } from "./deployment";
import { assertConfigured, resolveServerEnv } from "./env";

const values: Record<(typeof REQUIRED_SECRET_KEYS)[number], string> = {
  TURSO_AUTH_TOKEN: "database-token",
  TURSO_PLATFORM_TOKEN: "provisioning-token",
  TOKEN_ROOT_KEY: btoa("x".repeat(32)),
  SESSION_SECRET: "session-secret-at-least-thirty-two-characters",
  GOOGLE_CLIENT_SECRET: "google-secret",
  MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  RESEND_API_KEY: "re_email",
};
function bindings() {
  const secrets = Object.fromEntries(
    REQUIRED_SECRET_KEYS.map((key) => [
      key,
      { get: vi.fn(async () => values[key]) },
    ]),
  ) as Record<string, { get: () => Promise<string> }>;
  const raw = {
    ENVIRONMENT: "preview",
    APP_URL: "https://app-dev.example.com",
    API_URL: "https://api-dev.example.com",
    TURSO_DIRECTORY_URL: "libsql://directory-org.turso.io",
    TURSO_USER_HOST: "org.turso.io",
    TURSO_ORG: "org",
    TURSO_GROUP: "users",
    GOOGLE_CLIENT_ID: "google",
    MICROSOFT_CLIENT_ID: "microsoft",
    RESEND_FROM: "support@example.com",
    ...secrets,
  };
  return { raw, secrets };
}

test("M0 resolves core Secrets Store bindings and passes health without Stripe or OneSignal", async () => {
  const { raw, secrets } = bindings();
  const env = await resolveServerEnv(raw);
  expect(() => assertConfigured(env)).not.toThrow();
  expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  expect(env.ONESIGNAL_API_KEY).toBeUndefined();
  expect(await resolveServerEnv(raw)).toBe(env);
  for (const key of REQUIRED_SECRET_KEYS)
    expect(secrets[key]?.get).toHaveBeenCalledTimes(1);
});

test("explicit optional Secrets Store bindings are still resolved, not passed to the schema as objects", async () => {
  const get = vi.fn(async () => "sk_optional");
  const env = await resolveServerEnv({
    ...bindings().raw,
    STRIPE_SECRET_KEY: { get },
    STRIPE_WEBHOOK_SECRET: { get: async () => "whsec_optional" },
    ONESIGNAL_API_KEY: { get: async () => "push-optional" },
  });
  expect(env.STRIPE_SECRET_KEY).toBe("sk_optional");
  expect(env.STRIPE_WEBHOOK_SECRET).toBe("whsec_optional");
  expect(env.ONESIGNAL_API_KEY).toBe("push-optional");
  expect(get).toHaveBeenCalledOnce();
  await expect(
    resolveServerEnv({
      ...bindings().raw,
      STRIPE_PRO_PRICE_ID: "REPLACE_WITH_PRICE",
    }),
  ).rejects.toThrow("STRIPE_PRO_PRICE_ID");
});
