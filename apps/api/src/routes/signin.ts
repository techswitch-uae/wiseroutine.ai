import {
  beginSocialHandoff,
  claimSocialHandoff,
  completeSocialHandoff,
  createSocialHandoff,
} from "@wiseroutine/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createAuth } from "../auth";
import type { App } from "../context";
import { generateToken } from "../crypto";
import { handoffHash } from "../social-handoff";

/** Desktop sign-in uses a separate system-browser OAuth flow. The app retains
 * a private claim secret; only an unrelated attempt ID goes into browser URLs.
 * Better Auth's verified callback publishes its newly created session through
 * a server-owned proof, and a directory transaction redeems it once. */
export const signin = new Hono<App>();
signin.use("*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
  c.header("referrer-policy", "no-referrer");
});

signin.post("/social/start", async (c) => {
  const { provider } = await c.req
    .json<{ provider?: unknown }>()
    .catch(() => ({ provider: undefined }));
  if (provider !== "google" && provider !== "microsoft")
    throw new HTTPException(400, { message: "Unknown provider" });
  const id = generateToken();
  const ticket = generateToken();
  await createSocialHandoff(c.get("directory"), {
    id,
    claimHash: await handoffHash(ticket),
    provider,
    now: c.get("now"),
  });
  return c.json({
    url: `${c.get("env").API_URL}/signin/social/go?attempt=${id}`,
    ticket,
  });
});

/** Top-level browser navigation is where the OAuth state cookie must be set.
 * No claim secret, completion proof or session token is put in this URL. */
signin.get("/social/go", async (c) => {
  const env = c.get("env");
  const id = c.req.query("attempt") ?? "";
  const proof = generateToken();
  const proofHash = await handoffHash(proof);
  const row =
    id.length <= 128
      ? await beginSocialHandoff(
          c.get("directory"),
          id,
          proofHash,
          c.get("now"),
        )
      : null;
  const failure = (reason: string) =>
    c.redirect(`${env.APP_URL}/auth/complete?signin=failed&reason=${reason}`);
  if (!row || (row.provider !== "google" && row.provider !== "microsoft"))
    return failure("expired");

  // This instance's server-only before hook attaches the completion proof.
  // No public /auth/sign-in/social body or header can set it.
  const auth = createAuth(c.get("directory"), env, {
    id,
    proof,
    provider: row.provider,
  });
  const response = await auth.api
    .signInSocial({
      body: {
        provider: row.provider,
        callbackURL: `${env.APP_URL}/auth/complete?signin=ok`,
        errorCallbackURL: `${env.APP_URL}/auth/complete?signin=failed`,
        disableRedirect: true,
      },
      asResponse: true,
    })
    .catch(() => null);
  const result = response
    ? ((await response.json().catch(() => null)) as { url?: unknown } | null)
    : null;
  if (!response?.ok || typeof result?.url !== "string") {
    await completeSocialHandoff(c.get("directory"), {
      id,
      proofHash,
      provider: row.provider,
      now: Date.now(),
      result: { status: "failed", reason: "provider_unavailable" },
    });
    return failure("provider_unavailable");
  }
  const headers = new Headers({ location: result.url });
  for (const cookie of response.headers.getSetCookie())
    headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
});

/** Retire the insecure cookie-session landing. Old URLs fail closed and never
 * read a browser session, create a handoff, or mutate an existing attempt. */
signin.get("/social/finish", (c) =>
  c.redirect(
    `${c.get("env").APP_URL}/auth/complete?signin=failed&reason=expired`,
  ),
);

signin.post("/social/claim", async (c) => {
  const { ticket } = await c.req
    .json<{ ticket?: unknown }>()
    .catch(() => ({ ticket: undefined }));
  if (typeof ticket !== "string" || !ticket || ticket.length > 128)
    throw new HTTPException(400, { message: "Missing or invalid ticket" });
  return c.json(
    await claimSocialHandoff(
      c.get("directory"),
      await handoffHash(ticket),
      c.get("now"),
    ),
  );
});
