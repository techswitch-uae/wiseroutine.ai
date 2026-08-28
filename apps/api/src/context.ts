import {
  createDirectory,
  type Directory,
  type UserDatabase,
} from "@wiseroutine/db";
import { required } from "@wiseroutine/env";
import { type Capability, can, type PlanId } from "@wiseroutine/plans";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Auth, createAuth } from "./auth";
import {
  createUserDb,
  directoryCredentials,
  resolveServerEnv,
  type ServerEnv,
} from "./env";

/**
 * Cloudflare bindings.
 *
 * Note what is *not* here: the database. Turso is reached over HTTP with a URL
 * and a token, so it is configuration rather than a binding - which is also
 * why it can be opened from anywhere, including a queue consumer.
 */
export interface Bindings {
  SYNC_QUEUE: Queue<SyncJob>;
  CONFIG: KVNamespace;
  [key: string]: unknown;
}

export interface SyncJob {
  type: "sync-calendar" | "renew-watch" | "grace-sweep";
  /** Directory row id, so the consumer can reschedule or fail it. */
  workId: string;
  userId: string;
  databaseName: string;
  targetId?: string;
  reason?: string;
}

export interface SessionUser {
  userId: string;
  databaseName: string;
  plan: PlanId;
  timeZone: string;
  dayStartMinutes: number;
  dayEndMinutes: number;
  storeEventTitles: boolean;
  /** Null until the first request from their app. */
  lastSeenAt: number | null;
}

export interface Variables {
  env: ServerEnv;
  directory: Directory;
  auth: Auth;
  user: SessionUser;
  /** The signed-in user's own database. */
  db: UserDatabase;
  now: number;
}

export type App = { Bindings: Bindings; Variables: Variables };
export type Ctx = Context<App>;

export const newId = (): string => crypto.randomUUID();

/** Parse config and open the directory once per request. */
export const withContext: MiddlewareHandler<App> = async (c, next) => {
  const env = await resolveServerEnv(
    c.env as unknown as Record<string, unknown>,
  );
  const directory = createDirectory(directoryCredentials(env));
  c.set("env", env);
  c.set("directory", directory);
  c.set("auth", createAuth(directory, env));
  c.set("now", Date.now());
  await next();
};

/**
 * The pro-offer kill switch.
 *
 * A *sales* switch, not an entitlement switch: it closes checkout to new
 * customers and hides upgrade prompts. It must never revoke access someone
 * already paid for. Read from KV so it flips without a deploy.
 */
export async function proOfferEnabled(c: Ctx): Promise<boolean> {
  const value = await c.env.CONFIG.get("PRO_OFFER_ENABLED");
  if (value === null) return c.get("env").PRO_OFFER_ENABLED;
  return value !== "false";
}

export function rootKey(c: Ctx): string {
  return required(c.get("env").TOKEN_ROOT_KEY, "TOKEN_ROOT_KEY");
}

/**
 * Session auth.
 *
 * One call resolves the session, the user's settings *and* which database to
 * open - every authenticated route needs all three, and against a remote
 * database three separate lookups would be three round trips. The application
 * columns ride along because they are declared as `additionalFields` on the
 * user in `src/auth.ts`.
 */
export const requireUser: MiddlewareHandler<App> = async (c, next) => {
  const session = await c
    .get("auth")
    .api.getSession({ headers: c.req.raw.headers });

  if (!session || session.user.deletedAt) {
    throw new HTTPException(401, { message: "Invalid or expired session" });
  }

  // A user whose database is still being provisioned has nowhere to read from.
  if (!session.user.databaseReady) {
    throw new HTTPException(503, {
      message: "Your account is still being set up",
    });
  }

  c.set("user", {
    userId: session.user.id,
    databaseName: session.user.databaseName,
    plan: session.user.plan as PlanId,
    timeZone: session.user.timeZone,
    dayStartMinutes: session.user.dayStartMinutes,
    dayEndMinutes: session.user.dayEndMinutes,
    storeEventTitles: session.user.storeEventTitles,
    lastSeenAt: session.user.lastSeenAt?.getTime() ?? null,
  });
  c.set("db", createUserDb(c.get("env"), session.user.databaseName));

  await next();
};

/**
 * Enforce a plan capability.
 *
 * The client calls the same `can()` to decide what to disable, but this is the
 * side that counts. A gate that only exists in the UI is not a gate.
 */
export function enforce(c: Ctx, capability: Capability): void {
  const decision = can(c.get("user").plan, capability);
  if (!decision.ok) {
    throw new HTTPException(402, {
      res: Response.json(
        {
          error: "plan_limit",
          reason: decision.reason,
          upsell: decision.upsell,
        },
        { status: 402 },
      ),
    });
  }
}
