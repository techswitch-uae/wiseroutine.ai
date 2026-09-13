import { env, exports as worker } from "cloudflare:workers";
import { beforeEach, expect, test, vi } from "vitest";
import { createAuth } from "./auth";
import { resolveServerEnv } from "./env";
import { handoffHash } from "./social-handoff";
import { directory, resetDatabases, seedUser } from "./test-support";

beforeEach(resetDatabases);
const post = (path: string, body: unknown) =>
  worker.default.fetch(`http://api/signin/social/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const claim = async (ticket: string) => {
  const response = await post("claim", { ticket });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json() as Promise<{
    status: string;
    token?: string;
    reason?: string;
  }>;
};
async function start() {
  const response = await post("start", { provider: "google" });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { url: string; ticket: string };
  expect(result.url).not.toContain(result.ticket);
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  return {
    ...result,
    id: new URL(result.url).searchParams.get("attempt") as string,
  };
}
async function go(url: string) {
  const response = await worker.default.fetch(url, { redirect: "manual" });
  const state = new URL(
    response.headers.get("location") ?? "",
  ).searchParams.get("state");
  expect(state).toBeTruthy();
  const cookie = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  return { state: state as string, cookie };
}

/** Real Better Auth cookie/state validation, session creation and hooks.
 * Only the provider token exchange/profile are local fixtures, never live OAuth. */
async function callbackClient() {
  const user = await seedUser();
  await directory().user.update({
    where: { id: user.userId },
    data: { emailVerified: true },
  });
  const settings = await resolveServerEnv(
    env as unknown as Record<string, unknown>,
  );
  const auth = createAuth(directory(), settings);
  const provider = (await auth.$context).socialProviders.find(
    (provider) => provider.id === "google",
  );
  if (!provider) throw new Error("Missing test Google provider");
  const exchange = vi.fn(async ({ code }: { code: string }) => {
    if (code !== "verified-code") throw new Error("invalid provider code");
    return { accessToken: "fixture-access", scopes: ["openid", "email"] };
  });
  provider.validateAuthorizationCode = exchange;
  provider.getUserInfo = vi.fn(async () => ({
    user: {
      email: `${user.userId}@example.com`,
      name: "Test User",
      emailVerified: true,
    },
    data: { sub: user.userId, email: `${user.userId}@example.com` },
  }));
  return {
    auth,
    user,
    exchange,
    settings,
    finish: (state: string, cookie: string, extra = "code=verified-code") =>
      auth.handler(
        new Request(
          `${settings.API_URL}/auth/callback/google?state=${encodeURIComponent(state)}&${extra}`,
          { headers: { cookie } },
        ),
      ),
  };
}

test("direct completion cannot publish an existing browser session under any ticket", async () => {
  const client = await callbackClient();
  const own = await start();
  const browser = await go(own.url);
  const signedIn = await client.finish(browser.state, browser.cookie);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect((await claim(own.ticket)).status).toBe("ready");
  expect(
    await client.auth.api.getSession({ headers: new Headers({ cookie }) }),
  ).not.toBeNull();
  const attempt = await start();
  for (const ticket of ["unknown", attempt.ticket, attempt.id]) {
    const response = await worker.default.fetch(
      `http://api/signin/social/finish?ticket=${ticket}`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(response.headers.get("location")).toContain("signin=failed");
  }
  expect(await claim(attempt.ticket)).toEqual({ status: "pending" });
  expect(await claim(attempt.id)).toEqual({ status: "expired" });
  expect(await directory().socialHandoff.count()).toBe(1);
});

test("verified OAuth hands the newly created session to the app exactly once", async () => {
  const client = await callbackClient();
  const attempt = await start();
  const browser = await go(attempt.url);
  expect(await claim(attempt.ticket)).toEqual({ status: "pending" });
  const response = await client.finish(browser.state, browser.cookie);
  expect(response.headers.get("location")).toContain("signin=ok");
  expect(client.exchange).toHaveBeenCalledOnce();
  const result = await claim(attempt.ticket);
  expect(result.status).toBe("ready");
  expect(result.token).toBeTruthy();
  expect(result.token).not.toBe(client.user.token);
  expect(
    await directory().session.findUnique({ where: { token: result.token } }),
  ).toMatchObject({ userId: client.user.userId });
  expect(await claim(attempt.ticket)).toEqual({ status: "expired" });
  // Replaying the verified callback cannot recreate the consumed handoff.
  await client.finish(browser.state, browser.cookie);
  expect(await claim(attempt.ticket)).toEqual({ status: "expired" });
});

test("cross-browser or absent state cookies cannot complete an attempt", async () => {
  const client = await callbackClient();
  const first = await start();
  const second = await start();
  const a = await go(first.url);
  const b = await go(second.url);
  await client.finish(a.state, b.cookie);
  await client.finish(b.state, "");
  expect(client.exchange).not.toHaveBeenCalled();
  expect(await claim(first.ticket)).toEqual({ status: "pending" });
  expect(await claim(second.ticket)).toEqual({ status: "pending" });
});

test("client-supplied additionalData cannot inject server handoff context", async () => {
  const client = await callbackClient();
  const attempt = await start();
  await go(attempt.url);
  // Even knowledge of the raw proof must not let a different, public flow
  // impersonate a server-owned handoff. additionalData is untrusted input.
  const original = await directory().verification.findFirst({
    where: { identifier: { not: "" } },
  });
  const state = JSON.parse(original?.value ?? "{}");
  expect(state.serverContext?.wiseRoutineHandoff).toMatchObject({
    id: attempt.id,
  });
  const forged = await client.auth.api.signInSocial({
    body: {
      provider: "google",
      callbackURL: `${client.settings.APP_URL}/auth/complete?signin=ok`,
      disableRedirect: true,
      additionalData: { serverContext: state.serverContext },
    },
    asResponse: true,
  });
  const url = ((await forged.json()) as { url: string }).url;
  const cookie = forged.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  await client.finish(new URL(url).searchParams.get("state") as string, cookie);
  expect(client.exchange).toHaveBeenCalledOnce();
  expect(await claim(attempt.ticket)).toEqual({ status: "pending" });
});

test("expired attempts cannot start or publish a token on a late callback", async () => {
  const client = await callbackClient();
  const first = await start();
  await directory().socialHandoff.update({
    where: { id: first.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  expect(
    (await worker.default.fetch(first.url, { redirect: "manual" })).headers.get(
      "location",
    ),
  ).toContain("signin=failed");
  expect(await claim(first.ticket)).toEqual({ status: "expired" });
  const second = await start();
  const browser = await go(second.url);
  await directory().socialHandoff.update({
    where: { id: second.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  expect(
    (await client.finish(browser.state, browser.cookie)).headers.get(
      "location",
    ),
  ).toContain("signin=failed");
  expect(await claim(second.ticket)).toEqual({ status: "expired" });
});

test("provider refusal is bound to its flow, returned once, and cannot become ready", async () => {
  const client = await callbackClient();
  const attempt = await start();
  const browser = await go(attempt.url);
  await client.finish(browser.state, browser.cookie, "error=access_denied");
  expect(client.exchange).not.toHaveBeenCalled();
  expect(await claim(attempt.ticket)).toEqual({
    status: "failed",
    reason: "access_denied",
  });
  await client.finish(browser.state, browser.cookie);
  expect(await claim(attempt.ticket)).toEqual({ status: "expired" });
});

test("a browser attempt starts once and an invalid provider code cannot publish a token", async () => {
  const client = await callbackClient();
  const attempt = await start();
  const browser = await go(attempt.url);
  expect(
    (
      await worker.default.fetch(attempt.url, { redirect: "manual" })
    ).headers.get("location"),
  ).toContain("signin=failed");
  await client.finish(browser.state, browser.cookie, "code=invalid-code");
  const result = await claim(attempt.ticket);
  expect(result.status).toBe("failed");
  expect(result.token).toBeUndefined();
});

test("a ready but unclaimed session expires without being delivered", async () => {
  const client = await callbackClient();
  const attempt = await start();
  const browser = await go(attempt.url);
  await client.finish(browser.state, browser.cookie);
  const row = await directory().socialHandoff.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  expect(row.status).toBe("ready");
  expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(120_000);
  await directory().socialHandoff.update({
    where: { id: attempt.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  expect(await claim(attempt.ticket)).toEqual({ status: "expired" });
});

test("concurrent claims yield at most one token, not KV read/delete duplicates", async () => {
  const client = await callbackClient();
  const attempt = await start();
  const browser = await go(attempt.url);
  await client.finish(browser.state, browser.cookie);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => claim(attempt.ticket)),
  );
  expect(results.filter((result) => result.status === "ready")).toHaveLength(1);
  expect(results.filter((result) => result.status === "expired")).toHaveLength(
    4,
  );
  expect(
    await directory().socialHandoff.findUnique({
      where: { claimHash: await handoffHash(attempt.ticket) },
    }),
  ).toBeNull();
});
