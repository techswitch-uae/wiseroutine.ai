import {
  type Directory,
  newDatabaseName,
  USER_DEFAULTS,
} from "@wiseroutine/db";
import { required } from "@wiseroutine/env";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";
import type { ServerEnv } from "./env";
import { provisionUserDatabase } from "./provisioning";

/**
 * Authentication.
 *
 * Three ways in - a code emailed to the address, Google, or Microsoft - and
 * all three land on the same account when the address matches. What none of
 * them does is connect a calendar: that is a separate, later act with its own
 * consent and its own scopes (`routes/connect.ts`), which is what lets someone
 * sign in with Google and then sync an Outlook calendar, or the reverse.
 *
 * Built per request rather than once at module scope, because on Workers the
 * configuration arrives with the request and the directory client is opened
 * from it.
 */

const SESSION_DAYS = 30;

/** Also the number in the email and on the screen - see `sendOtp`. */
const OTP_MINUTES = 10;

/**
 * The social providers that are actually configured.
 *
 * Both halves of a credential or nothing: passing a `clientId` with an
 * undefined `clientSecret` gets past startup and fails at the token exchange,
 * which is a much worse place to find out. A laptop with neither still boots
 * and still has the emailed code.
 *
 * The client ids are the same registrations `routes/connect.ts` uses. One app
 * per provider, two grants with different scopes: signing in asks only for an
 * identity, connecting a calendar asks for the calendar. Reusing the
 * registration is what keeps the consent screen naming one app rather than
 * two, and it costs nothing because the scopes are requested per flow.
 */
function configuredProviders(env: ServerEnv) {
  return {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Someone with a work and a personal Google is the normal case
            // here, not the exotic one. Without this the browser's existing
            // session decides for them, silently.
            prompt: "select_account" as const,
          },
        }
      : {}),
    ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            // "common" admits both work/school tenants and personal accounts.
            // A single-tenant value here would lock out every consumer
            // Outlook address.
            tenantId: "common",
            prompt: "select_account" as const,
            // Entra returns the avatar as base64 *in the profile*, which can
            // be large enough to blow the header limit and fail the whole
            // sign-in. We show initials anyway (`Avatar`), so drop it -
            // `undefined` rather than `null`, which is what the mapped-user
            // type accepts for "no value".
            mapProfileToUser: () => ({ image: undefined }),
          },
        }
      : {}),
  };
}

/**
 * Fields the application owns on the user row.
 *
 * All `input: false`: they are readable through a session but nothing a client
 * sends can write them - otherwise a signup body could set its own `plan`.
 * Every one has a database default except `databaseName`, which is generated
 * here because the column is NOT NULL and nothing else can supply it.
 */
const userFields = {
  databaseName: {
    type: "string",
    required: true,
    input: false,
    // Not the `create.before` hook: required fields are validated before it
    // runs, so a value injected there arrives too late and signup fails with
    // "databaseName is required".
    defaultValue: () => newDatabaseName(),
  },
  // Every one of these needs a `defaultValue` even though the column has one:
  // Better Auth validates its own required-field list before any hook or
  // insert, so "the database will fill it in" is not an answer it accepts.
  // The values live in @wiseroutine/db beside the schema they mirror.
  databaseReady: {
    type: "boolean",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.databaseReady,
  },
  timeZone: {
    type: "string",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.timeZone,
  },
  locale: {
    type: "string",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.locale,
  },
  dayStartMinutes: {
    type: "number",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.dayStartMinutes,
  },
  dayEndMinutes: {
    type: "number",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.dayEndMinutes,
  },
  // The custom day-view range. Optional rather than defaulted: an account
  // that has never named one has no range, which is not the same as a range
  // spanning nothing - and `required: false` is what lets it be cleared.
  customRangeLabel: { type: "string", required: false, input: false },
  customRangeStartMinutes: { type: "number", required: false, input: false },
  customRangeEndMinutes: { type: "number", required: false, input: false },
  dayOpensOn: {
    type: "string",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.dayOpensOn,
  },
  showOutsideRange: {
    type: "boolean",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.showOutsideRange,
  },
  plan: {
    type: "string",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.plan,
  },
  planSource: {
    type: "string",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.planSource,
  },
  storeEventTitles: {
    type: "boolean",
    required: true,
    input: false,
    defaultValue: () => USER_DEFAULTS.storeEventTitles,
  },
  lastSeenAt: { type: "date", required: false, input: false },
  deletedAt: { type: "date", required: false, input: false },
} as const satisfies Record<
  string,
  {
    type: "string" | "number" | "boolean" | "date";
    required: boolean;
    input: false;
    defaultValue?: () => string | number | boolean;
  }
>;

/**
 * Deliver the sign-in code.
 *
 * The SDK **resolves** on a rejected send and puts the reason in `error`
 * rather than throwing, so an unchecked call looks like success and the user
 * waits for a mail that was never accepted. Turning that back into a throw is
 * what lets Better Auth surface it: the OTP has already been written to
 * `verifications` by this point, and a code nobody can receive has to fail the
 * request rather than sit there until it expires.
 */
async function sendOtp(env: ServerEnv, to: string, otp: string): Promise<void> {
  const resend = new Resend(required(env.RESEND_API_KEY, "RESEND_API_KEY"));

  const { error } = await resend.emails.send({
    from: required(env.RESEND_FROM, "RESEND_FROM"),
    to,
    // The code leads the subject too, so a phone notification is usually
    // enough and the mail never has to be opened.
    subject: `${otp} is your Wise Routine code`,
    // Built from lines rather than a string with `\n` escapes in it. The
    // escapes are correct JavaScript but invisible in review and easy to lose
    // to a reformat - and losing them runs the code straight into the sentence
    // after it, which is what shipped.
    text: [
      otp,
      "",
      `This code expires in ${OTP_MINUTES} minutes.`,
      "If you didn't ask to sign in, you can ignore this email.",
    ].join("\n"),
  });

  if (error) {
    // `error.message` is Resend's own wording - safe to log, and specific
    // enough to tell an unverified domain from a bad key.
    throw new Error(`Resend refused: ${error.name}: ${error.message}`);
  }
}

export function createAuth(directory: Directory, env: ServerEnv) {
  return betterAuth({
    database: prismaAdapter(directory, { provider: "sqlite" }),
    baseURL: env.API_URL,
    basePath: "/auth",
    secret: required(env.SESSION_SECRET, "SESSION_SECRET"),
    // The desktop app's webview is not served from APP_URL: Tauri gives it a
    // scheme of its own, which differs by platform. Omitting these makes
    // sign-in fail in the packaged app while working in the browser.
    trustedOrigins: [
      env.APP_URL,
      "tauri://localhost",
      "http://tauri.localhost",
      // ponytail: the design gallery runs on its own Vite port (`pnpm design`)
      // and is not APP_URL. Hardcoded, not configurable - one dev port.
      ...(env.ENVIRONMENT === "development" ? ["http://localhost:41100"] : []),
    ],

    /**
     * Better Auth catches its own errors and returns a response, so nothing
     * reaches `api.onError` and a failed sign-in leaves no trace at all -
     * "couldn't send the code" on the client and a silent log on the server.
     * This is the only place that failure becomes visible.
     */
    onAPIError: {
      onError: (error) => {
        console.error("auth error", error);
      },
    },

    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      /**
       * Without this every caller shares one rate-limit bucket per path - the
       * counters key on `no-trusted-ip` - so one person hammering sign-in
       * locks out everybody. Cloudflare sets `CF-Connecting-IP` itself on
       * every request that reaches a Worker and strips any client-supplied
       * copy, which is what makes it safe to trust here and would not be true
       * of `X-Forwarded-For`.
       */
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },

    session: { expiresIn: SESSION_DAYS * 86_400 },

    socialProviders: configuredProviders(env),

    /**
     * Which identities are allowed to become the same account.
     *
     * Linking is on, and the rule is the provider's own word: Google asserts
     * `email_verified`, so a Google sign-in joins the account that already
     * owns that address. Microsoft is deliberately *not* in
     * `trustedProviders` - Entra's `email` claim is tenant-mutable and never
     * verified by Microsoft, so trusting it would let a tenant administrator
     * mint a claim for an address they do not control and walk into that
     * account. A Microsoft sign-in on an address we already know therefore
     * fails with `account_not_linked`, and the sign-in screen says to use the
     * emailed code instead. That is the safe direction to be wrong in.
     */
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        /**
         * Take the name and picture when a provider is linked.
         *
         * Without this, someone who signed up with an emailed code - which
         * asks for nothing but an address - and *later* connected Google keeps
         * an empty name for ever, and the sidebar has nothing to call them but
         * their own email address. The provider is the only thing that ever
         * knew their name, and a link is the moment it tells us.
         *
         * Safe against identity drift: Better Auth never changes `email` or
         * `emailVerified` on a link, and every application column we own is
         * `input: false`, so a provider profile cannot reach `plan` or
         * `databaseName`. Worth revisiting only when the app lets someone edit
         * their own name - at that point a later link would overwrite it.
         */
        updateUserInfoOnLink: true,
        /**
         * Let someone remove their last provider.
         *
         * Better Auth refuses by default, and for most applications it is
         * right: unlink the only account and you have locked yourself out.
         * Not here. Every account is reachable by a code emailed to its own
         * address - that is the primary way in, not a fallback - so a provider
         * is only ever a shortcut, and refusing to remove the last one would
         * trap people in a sign-in method they no longer want.
         */
        allowUnlinkingAll: true,
      },
    },

    // In-memory counters would not limit anything: a Worker isolate is
    // per-colo and short-lived, and the endpoint being limited sends email.
    rateLimit: {
      enabled: true,
      storage: "database",
      /**
       * Except the one endpoint the app polls.
       *
       * Every rate-limited request is a read-modify-write *transaction* on
       * `rateLimit`, and `/get-session` is asked on every mount, every focus
       * and every sync tick - by two clients at once if a browser tab and the
       * desktop window are both open. Against local `turso dev`, which is one
       * SQLite file with one writer, those transactions collide with each
       * other and with `touchLastSeen` and lose: `SQLITE_BUSY`, an unhandled
       * throw out of the limiter, and a 500 on the session read at every cold
       * start. Limiting it bought nothing anyway - it costs no email and no
       * work, and it is already gated by a token. The limits that matter,
       * sign-in and the emailed code, are untouched.
       */
      customRules: { "/get-session": false },
    },

    user: {
      // Prisma's `avatarUrl` is Better Auth's `image`.
      fields: { image: "avatarUrl" },
      additionalFields: userFields,
    },

    databaseHooks: {
      user: {
        create: {
          /**
           * Signup provisions infrastructure.
           *
           * One database per user means this is a Turso create, a migration
           * run and a seed - awaited here, not deferred, because the session
           * about to be issued is worthless until the database exists. It is
           * idempotent, so a retried signup recovers rather than leaving half
           * an account.
           */
          after: async (user) => {
            await provisionUserDatabase(
              directory,
              env,
              // The name the insert actually used, not one recomputed here.
              { userId: user.id, databaseName: String(user.databaseName) },
              Date.now(),
              () => crypto.randomUUID(),
            );
          },
        },
      },
    },

    plugins: [
      emailOTP({
        expiresIn: OTP_MINUTES * 60,
        // Three tries before the code is burned. Enough to survive a
        // transposed digit, few enough that guessing six digits is not a
        // strategy - and the screen counts the remaining attempts down so a
        // wrong code is never a surprise dead end.
        allowedAttempts: 3,
        // Sign-in and sign-up are the same act: an address that proves it can
        // read its own mail. No separate registration step to abandon.
        async sendVerificationOTP({ email, otp }) {
          await sendOtp(env, email, otp);
        },
      }),
      // The desktop app has no cookie jar worth the name, so it carries the
      // session as a bearer token instead.
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
