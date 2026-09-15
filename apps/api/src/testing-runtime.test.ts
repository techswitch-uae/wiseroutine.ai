import { env as bindings } from "cloudflare:workers";
import { Hono } from "hono";
import { expect, test, vi } from "vitest";
import type { App } from "./context";
import { resolveServerEnv, type ServerEnv, userCredentials } from "./env";
import { testing } from "./routes/testing";
import {
  authTestBoundaries,
  providerTestCalendars,
  providerTestReader,
  requestTime,
} from "./testing-runtime";

const key = "test-boundary-secret-long-enough";
async function config() {
  return resolveServerEnv(bindings as unknown as Record<string, unknown>);
}

test.each([
  { environment: "production", configured: key, supplied: key },
  { environment: "development", configured: undefined, supplied: key },
  { environment: "development", configured: key, supplied: "wrong-key" },
] as const)(
  "test endpoints refuse before any database access: $environment/$supplied",
  async ({ environment, configured, supplied }) => {
    const settings = {
      ...(await config()),
      ENVIRONMENT: environment,
      E2E_SECRET: configured,
    } as ServerEnv;
    const app = new Hono<App>();
    app.use("*", async (c, next) => {
      c.set("env", settings);
      await next();
    });
    app.route("/test", testing);
    // No directory/auth/db is installed: touching one would turn this into 500.
    for (const path of [
      "reset",
      "seed",
      "clock",
      "mail",
      "mail/expire",
      "infrastructure",
      "inspect",
      "saved-slot",
      "routine",
      "calendar/delta",
    ]) {
      const response = await app.request(`/test/${path}`, {
        method: "POST",
        headers: { "x-e2e-key": supplied, "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status, path).toBe(404);
    }
  },
);

test("test clocks, mail, provider pages and secondary routing are inert in production", async () => {
  const get = vi.fn();
  const kv = { get } as unknown as KVNamespace;
  const settings = {
    ...(await config()),
    ENVIRONMENT: "production",
    E2E_SECRET: key,
    E2E_SECOND_USER_URL: "http://127.0.0.1:9999",
    TURSO_USER_HOST: "production.turso.io",
  } as ServerEnv;
  expect(authTestBoundaries(settings, kv)).toEqual({});
  const now = Date.now();
  expect(await requestTime(settings, kv)).toBeGreaterThanOrEqual(now);
  expect(await providerTestReader(settings, kv, "calendar")).toBeUndefined();
  expect(
    await providerTestCalendars(settings, kv, "connection"),
  ).toBeUndefined();
  expect(get).not.toHaveBeenCalled();
  expect(userCredentials(settings, "wr-e2e-secondary").url).not.toContain(
    "127.0.0.1",
  );
  const { E2E_SECRET: _secret, ...withoutSecret } = settings;
  expect(
    userCredentials(
      { ...withoutSecret, ENVIRONMENT: "development" },
      "wr-e2e-secondary",
    ).url,
  ).not.toContain("127.0.0.1");
});
