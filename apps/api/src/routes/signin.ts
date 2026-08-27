import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { App } from "../context";
import { generateToken } from "../crypto";

/**
 * Social sign-in, for a client that has no cookie jar.
 *
 * Better Auth's own `/auth/sign-in/social` is mounted and works unchanged in a
 * browser: it redirects, the provider redirects back, and the session lands in
 * a cookie. The desktop app is the problem. Consent has to happen in the
 * *system* browser — a provider will not render its consent screen inside an
 * embedded webview, and Google actively blocks it — so the session is created
 * in a browser that is not the app, and the cookie it sets is worthless to us.
 *
 * So the app is handed a claim ticket before the browser ever opens. The
 * ticket is minted here, travels out in the callback URL, and the session
 * token is parked against it when consent completes; the app then exchanges
 * the ticket it has been holding all along. Nothing has to find its way back
 * into the app process, which is what makes this work without a deep link,
 * a loopback listener or a custom URL scheme registration per platform.
 *
 * The ticket is minted server-side on purpose. If the app chose it, someone
 * who could get a victim to start a sign-in with an attacker-chosen ticket
 * could then claim the victim's session — the same reason `routes/connect.ts`
 * keeps its OAuth state out of the caller's hands.
 */
export const signin = new Hono<App>();

/** Long enough to read an email and pick an account, short enough that an
 *  abandoned attempt is not a token sitting in KV all day. */
const TICKET_TTL_SECONDS = 600;

/** Once consent lands, the app is already polling. This only has to survive
 *  the gap until its next poll. */
const TOKEN_TTL_SECONDS = 120;

const ticketKey = (ticket: string) => `signin_handoff:${ticket}`;

type Parked =
  | { status: "pending" }
  | { status: "ready"; token: string }
  | { status: "failed"; reason: string };

function parseProvider(value: unknown): "google" | "microsoft" {
  if (value !== "google" && value !== "microsoft") {
    throw new HTTPException(400, { message: "Unknown provider" });
  }
  return value;
}

/**
 * Begin. Returns the consent URL to open and the ticket to redeem after.
 *
 * Unauthenticated by definition — this is how someone with no account gets
 * one. Signing up and signing in are the same call: whether the address is
 * new is Better Auth's business, and the account it creates is provisioned by
 * the same `user.create` hook the emailed code goes through.
 */
signin.post("/social/start", async (c) => {
  const env = c.get("env");
  const body: { provider?: unknown } = await c.req
    .json<{ provider?: unknown }>()
    .catch(() => ({}));
  const provider = parseProvider(body.provider);

  const ticket = generateToken();
  await c.env.CONFIG.put(
    ticketKey(ticket),
    JSON.stringify({ status: "pending" } satisfies Parked),
    { expirationTtl: TICKET_TTL_SECONDS },
  );

  const finish = `${env.API_URL}/signin/social/finish?ticket=${ticket}`;

  // A provider with no credentials in this environment is not an error the
  // caller made, and Better Auth signals it by throwing. Catching it here is
  // what turns "500, look in the logs" into an answer the sign-in screen can
  // show — and it is the same answer whether the provider is unconfigured or
  // momentarily refusing, because neither is something the user can fix.
  const result = await c
    .get("auth")
    .api.signInSocial({
      body: {
        provider,
        callbackURL: finish,
        // A refusal has to reach the same place a success does, or the app
        // polls a ticket that will never be filled until it times out — and
        // the user watches a spinner instead of reading why it failed.
        errorCallbackURL: finish,
        // We want the URL handed back to us, not a redirect thrown at a
        // browser that is not there.
        disableRedirect: true,
      },
    })
    .catch((error: unknown) => {
      console.error("social sign-in unavailable", provider, error);
      return null;
    });

  if (!result?.url) {
    throw new HTTPException(503, { message: "Provider unavailable" });
  }

  return c.json({ url: result.url, ticket });
});

/**
 * Where consent lands, in the browser.
 *
 * Better Auth has already created the session and set its cookie on the
 * redirect that got us here, so reading it back is just `getSession` — the
 * token that comes out is the same value the bearer plugin returns as
 * `set-auth-token` after an emailed code, which is why the app can use it
 * without knowing which way it signed in.
 */
signin.get("/social/finish", async (c) => {
  const env = c.get("env");
  const ticket = c.req.query("ticket");
  const done = new URL(`${env.APP_URL}/auth/complete`);

  // No ticket means this URL was not one we minted. Nothing to park a token
  // against, so there is nothing useful to do but say so.
  if (!ticket) {
    done.searchParams.set("signin", "failed");
    return c.redirect(done.toString());
  }

  const park = async (value: Parked, ttl: number) => {
    await c.env.CONFIG.put(ticketKey(ticket), JSON.stringify(value), {
      expirationTtl: ttl,
    });
  };

  // Better Auth appends its own `error` to the callback when consent fails or
  // the identity is refused.
  const refusal = c.req.query("error");
  if (refusal) {
    await park({ status: "failed", reason: refusal }, TOKEN_TTL_SECONDS);
    done.searchParams.set("signin", "failed");
    done.searchParams.set("reason", refusal);
    return c.redirect(done.toString());
  }

  const session = await c
    .get("auth")
    .api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    await park({ status: "failed", reason: "no_session" }, TOKEN_TTL_SECONDS);
    done.searchParams.set("signin", "failed");
    return c.redirect(done.toString());
  }

  await park(
    { status: "ready", token: session.session.token },
    TOKEN_TTL_SECONDS,
  );

  done.searchParams.set("signin", "ok");
  return c.redirect(done.toString());
});

/**
 * Redeem the ticket for the session token.
 *
 * Single use: the token is deleted as it is handed over, so a ticket that
 * leaks after the fact is worth nothing. `pending` is the normal answer while
 * the user is still choosing an account, and the app keeps asking.
 */
signin.post("/social/claim", async (c) => {
  const body: { ticket?: unknown } = await c.req
    .json<{ ticket?: unknown }>()
    .catch(() => ({}));
  if (typeof body.ticket !== "string" || !body.ticket) {
    throw new HTTPException(400, { message: "Missing ticket" });
  }

  const stored = await c.env.CONFIG.get(ticketKey(body.ticket));
  // Expired, already redeemed, or never existed — all the same answer, so a
  // wrong guess learns nothing from the difference.
  if (!stored) return c.json({ status: "expired" });

  const parked = JSON.parse(stored) as Parked;
  if (parked.status === "pending") return c.json({ status: "pending" });

  await c.env.CONFIG.delete(ticketKey(body.ticket));

  if (parked.status === "failed") {
    return c.json({ status: "failed", reason: parked.reason });
  }
  return c.json({ status: "ready", token: parked.token });
});
