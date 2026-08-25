import { type Directory, databaseNameFor } from "@wiseroutine/db";
import { required } from "@wiseroutine/env";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { ServerEnv } from "./env";
import { provisionUserDatabase } from "./provisioning";

/**
 * Authentication.
 *
 * One factor: a code emailed to the address. No password to leak, no social
 * login to make sign-in depend on Google's verification queue. Connecting a
 * calendar is a separate, later act — see `routes/connect.ts`.
 *
 * Built per request rather than once at module scope, because on Workers the
 * configuration arrives with the request and the directory client is opened
 * from it.
 */

const SESSION_DAYS = 30;

/**
 * Fields the application owns on the user row.
 *
 * All `input: false`: they are readable through a session but nothing a client
 * sends can write them — otherwise a signup body could set its own `plan`.
 * Every one of them has a database default except `databaseName`, which the
 * create hook below supplies.
 */
const userFields = {
  databaseName: { type: "string", required: true, input: false },
  databaseReady: { type: "boolean", required: true, input: false },
  timeZone: { type: "string", required: true, input: false },
  locale: { type: "string", required: true, input: false },
  dayStartMinutes: { type: "number", required: true, input: false },
  dayEndMinutes: { type: "number", required: true, input: false },
  plan: { type: "string", required: true, input: false },
  planSource: { type: "string", required: true, input: false },
  storeEventTitles: { type: "boolean", required: true, input: false },
  lastSeenAt: { type: "date", required: false, input: false },
  deletedAt: { type: "date", required: false, input: false },
} as const satisfies Record<
  string,
  {
    type: "string" | "number" | "boolean" | "date";
    required: boolean;
    input: false;
  }
>;

async function sendOtp(env: ServerEnv, to: string, otp: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${required(env.RESEND_API_KEY, "RESEND_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: required(env.RESEND_FROM, "RESEND_FROM"),
      to,
      subject: `${otp} is your Wise Routine code`,
      // The code is in the subject line too, so a phone notification is often
      // enough and the mail never has to be opened.
      text: `${otp}\n\nThis code expires in 5 minutes. If you didn't ask to sign in, ignore this email.`,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Resend refused: ${response.status} ${await response.text()}`,
    );
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
    ],

    advanced: { database: { generateId: () => crypto.randomUUID() } },

    session: { expiresIn: SESSION_DAYS * 86_400 },

    // In-memory counters would not limit anything: a Worker isolate is
    // per-colo and short-lived, and the endpoint being limited sends email.
    rateLimit: { enabled: true, storage: "database" },

    user: {
      // Prisma's `avatarUrl` is Better Auth's `image`.
      fields: { image: "avatarUrl" },
      additionalFields: userFields,
    },

    databaseHooks: {
      user: {
        create: {
          // `database_name` is NOT NULL and derived from the id, so it has to
          // be part of the insert rather than a follow-up update.
          before: async (user) => ({
            data: { ...user, databaseName: databaseNameFor(user.id) },
          }),

          /**
           * Signup provisions infrastructure.
           *
           * One database per user means this is a Turso create, a migration
           * run and a seed — awaited here, not deferred, because the session
           * about to be issued is worthless until the database exists. It is
           * idempotent, so a retried signup recovers rather than leaving half
           * an account.
           */
          after: async (user) => {
            await provisionUserDatabase(
              directory,
              env,
              { userId: user.id, databaseName: databaseNameFor(user.id) },
              Date.now(),
              () => crypto.randomUUID(),
            );
          },
        },
      },
    },

    plugins: [
      emailOTP({
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
