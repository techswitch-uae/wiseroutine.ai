import { z } from "zod";

/**
 * The configuration this package needs.
 *
 * Declared here so the contract lives with the code that defines it - but the
 * package never reads it. Every entry point takes its credentials as
 * parameters; the app composes this fragment and does the reading.
 */
export const providerKeys = {
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
};
