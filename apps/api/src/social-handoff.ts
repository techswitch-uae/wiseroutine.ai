import { completeSocialHandoff, type Directory } from "@wiseroutine/db";
import type { BetterAuthOptions } from "better-auth";
import {
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api";

/** Never accepted from request JSON. Only /social/go constructs this context. */
export interface SocialHandoffAttempt {
  id: string;
  proof: string;
  provider: "google" | "microsoft";
}

export async function handoffHash(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function asAttempt(value: unknown): SocialHandoffAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as Partial<SocialHandoffAttempt>;
  return typeof attempt.id === "string" &&
    typeof attempt.proof === "string" &&
    (attempt.provider === "google" || attempt.provider === "microsoft")
    ? (attempt as SocialHandoffAttempt)
    : null;
}

export function socialHandoffHooks(
  directory: Directory,
  appUrl: string,
  attempt?: SocialHandoffAttempt,
): NonNullable<BetterAuthOptions["hooks"]> {
  return {
    before: createAuthMiddleware(async (ctx) => {
      if (attempt && ctx.path === "/sign-in/social") {
        // Better Auth overwrites any additionalData.serverContext. Public
        // sign-in callers cannot manufacture this server-owned proof.
        await addOAuthServerContext({ wiseRoutineHandoff: attempt });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (
        (ctx.request?.method ?? ctx.method) !== "GET" ||
        ctx.path !== "/callback/:id"
      )
        return;
      // Only parseState's verified cookie/state reaches this callback context.
      const flow = asAttempt(
        (await getOAuthState())?.serverContext?.wiseRoutineHandoff,
      );
      if (!flow || ctx.params?.id !== flow.provider) return;
      // Crucially, not getSession(): an existing browser session is not proof
      // of a completed OAuth flow. This is the new session from this callback.
      const session = ctx.context.newSession?.session;
      const location = ctx.context.responseHeaders?.get("location");
      const error = location
        ? new URL(location, appUrl).searchParams.get("error")
        : null;
      const reason =
        error && /^[a-z_]{1,80}$/.test(error) ? error : "authentication_failed";
      const completed = await completeSocialHandoff(directory, {
        id: flow.id,
        provider: flow.provider,
        proofHash: await handoffHash(flow.proof),
        now: Date.now(),
        result: session
          ? { status: "ready", token: session.token }
          : { status: "failed", reason },
      });
      if (!completed) {
        // A late/replayed callback must not tell the browser the app signed in.
        ctx.setHeader(
          "location",
          `${appUrl}/auth/complete?signin=failed&reason=expired`,
        );
      }
    }),
  };
}
