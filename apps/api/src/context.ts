import type { AddonCapability } from "@wiseroutine/addons";
import {
  applyMigrations,
  createDirectory,
  type Directory,
  refreshUserPlan,
  USER_MIGRATIONS,
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
  userCredentials,
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
  /**
   * Named rather than left to the index signature, because CORS runs before
   * `withContext` and so reads these off the raw bindings rather than the
   * resolved `ServerEnv` - see `trustedOrigins` in `auth.ts`. Both are plain
   * `vars` in wrangler.jsonc, never secrets, so they are strings here as well
   * as there.
   */
  APP_URL: string;
  ENVIRONMENT?: string;
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
  /** The one named day-view range, or null if none has been configured. */
  customRangeLabel: string | null;
  customRangeStartMinutes: number | null;
  customRangeEndMinutes: number | null;
  /** "working" | "full" | "custom" - which range the day view opens on. */
  dayOpensOn: string;
  showOutsideRange: boolean;
  storeEventTitles: boolean;
  /** Null until the first request from their app. */
  lastSeenAt: number | null;
}

/**
 * The addon a request is made for, from the `x-wr-addon` header.
 *
 * The desktop host sets it on every write it proxies for an addon. The route
 * then checks the grant and, for slots, ownership. Null for the user's own
 * requests.
 */
export interface AddonActor {
  id: string;
  granted: readonly AddonCapability[];
}

export interface Variables {
  env: ServerEnv;
  directory: Directory;
  auth: Auth;
  user: SessionUser;
  /** The signed-in user's own database. */
  db: UserDatabase;
  now: number;
  addon: AddonActor | null;
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

  /**
   * A grant that has run out has to actually take effect.
   *
   * `plan` is cached on the user row and recomputed by `refreshUserPlan`,
   * which the comment there says is never called on the hot path - correct for
   * a Stripe subscription, whose end always arrives as a webhook. A trial
   * grant has no webhook: nobody tells us the fourteenth day has passed, so
   * without this a trial would expire on paper and never in practice.
   *
   * One extra write, on the first request after the date passes, and nothing
   * at all on every other request.
   */
  const expiresAt = session.user.planExpiresAt?.getTime();
  const plan =
    expiresAt !== undefined && expiresAt <= c.get("now")
      ? (
          await refreshUserPlan(
            c.get("directory"),
            session.user.id,
            c.get("now"),
          )
        ).plan
      : (session.user.plan as PlanId);

  c.set("user", {
    userId: session.user.id,
    databaseName: session.user.databaseName,
    plan,
    timeZone: session.user.timeZone,
    dayStartMinutes: session.user.dayStartMinutes,
    dayEndMinutes: session.user.dayEndMinutes,
    customRangeLabel: session.user.customRangeLabel ?? null,
    customRangeStartMinutes: session.user.customRangeStartMinutes ?? null,
    customRangeEndMinutes: session.user.customRangeEndMinutes ?? null,
    dayOpensOn: session.user.dayOpensOn,
    showOutsideRange: session.user.showOutsideRange,
    storeEventTitles: session.user.storeEventTitles,
    lastSeenAt: session.user.lastSeenAt?.getTime() ?? null,
  });
  await catchUpSchema(c, session.user.id, {
    databaseName: session.user.databaseName,
    schemaVersion: session.user.schemaVersion,
  });

  c.set("db", createUserDb(c.get("env"), session.user.databaseName));

  await next();
};

/**
 * Bring a user's database up to the migrations this Worker carries.
 *
 * The same shape as the plan-expiry refresh above, and for the same reason:
 * one extra read that is an integer comparison on every request, one write on
 * the first request after a deploy that added a migration, and nothing at all
 * on all the others.
 *
 * It is here rather than in a background job because it must finish *before*
 * the handler reads the database. A route that ran against a schema one
 * migration behind would not fail loudly - it would read a renamed column as
 * absent, which is the quiet kind of wrong.
 *
 * ## Why this exists at all
 *
 * `provisionUserDatabase` was the only caller of `applyMigrations`, so
 * migrations ran exactly once per account: at signup. Everything written
 * afterwards reached new users and nobody else. That was survivable while
 * migrations only added columns nothing read yet, and stopped being survivable
 * when they started *renaming* things - 0010 and 0012 move activities onto
 * their addons' keys, and a user who never receives them is a user whose
 * guided sessions quietly stop opening.
 *
 * ## When it fails
 *
 * The request continues. `applyMigrations` records what it applied in the
 * user's own `_migrations` table and skips it next time, so a half-finished
 * run is resumed rather than repeated - and refusing to serve a user because
 * one statement failed would turn a stale column into an outage. The version
 * is written only after the whole run succeeds, so a failure means the next
 * request tries again.
 */
async function catchUpSchema(
  c: Context<App>,
  userId: string,
  user: { databaseName: string; schemaVersion: number },
): Promise<void> {
  if (user.schemaVersion >= USER_MIGRATIONS.length) return;

  try {
    await applyMigrations(
      userCredentials(c.get("env"), user.databaseName),
      USER_MIGRATIONS,
    );
    await c.get("directory").user.update({
      where: { id: userId },
      data: { schemaVersion: USER_MIGRATIONS.length },
    });
  } catch (error) {
    console.error("schema catch-up", userId, error);
  }
}

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
