import { z } from "zod";

/**
 * The configuration this package needs.
 *
 * Declared here so the contract lives with the code that defines it - but the
 * package never reads it. Callers pass `Credentials` in; the app composes this
 * fragment and does the reading.
 */
export const databaseKeys = {
  /** The one shared directory database: login, sessions, billing, scheduling. */
  TURSO_DIRECTORY_URL: z.string().optional(),
  /** Group-scoped, so one token reaches every user database. */
  TURSO_AUTH_TOKEN: z.string().optional(),
  /** Either a Turso host suffix ("myorg.turso.io") or, locally, the full URL of
   *  a `turso dev` server that serves a single database. */
  TURSO_USER_HOST: z.string().optional(),
  /** Platform API credentials, used only to create a database at signup. */
  TURSO_PLATFORM_TOKEN: z.string().optional(),
  TURSO_ORG: z.string().optional(),
  TURSO_GROUP: z.string().default("default"),
};
