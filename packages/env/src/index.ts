import { z } from "zod";

/**
 * Core configuration, and the machinery each package uses to declare its own.
 *
 * The next-forge shape, adapted: there, a package's `keys()` returns a parsed
 * env object and the package *calls it itself* - `packages/payments/index.ts`
 * does `const { STRIPE_SECRET_KEY } = keys()`. Ours are dependency-injected
 * instead (`createDirectory({ url, authToken })`, `googleExchangeCode({
 * clientId, ... })`), so nothing under `packages/` reads the environment at
 * all. A `keys()` returning a parsed env would have no caller inside its own
 * package.
 *
 * So a package exports a **schema fragment** rather than a reader: it still
 * owns and documents its configuration contract, and deleting the package
 * deletes its requirements - but the app stays the only thing that touches the
 * environment.
 *
 * Secrets are optional so the Worker boots with a partial config in local dev;
 * the feature needing a missing key fails loudly at its call site via
 * `required()` rather than taking the whole app down at import.
 */
export type EnvFragment = Record<string, z.ZodType>;

/** Everything that is not owned by a package: the app's own identity. */
export const coreKeys = {
  ENVIRONMENT: z
    .enum(["development", "preview", "production"])
    .default("development"),
  APP_URL: z.url().default("http://localhost:41000"),
  API_URL: z.url().default("http://localhost:8787"),

  /**
   * Unlocks the seeding routes the browser tests drive.
   *
   * Three locks, because this mints sessions: the routes refuse outright in
   * production, they do not exist unless this is set, and every call must
   * present it. Leave it unset everywhere except a local run and CI.
   */
  E2E_SECRET: z.string().min(16).optional(),

  /** Root key for envelope-encrypting per-user OAuth tokens. 32 bytes, base64. */
  TOKEN_ROOT_KEY: z.base64().optional(),
  SESSION_SECRET: z.string().min(32).optional(),

  /** The sales switch. "false" closes the pro offer to new customers without
   *  touching anyone's existing access. Read from KV at runtime, not here. */
  PRO_OFFER_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
} satisfies EnvFragment;

/**
 * Compose fragments into one schema and a parser.
 *
 * On Workers there is no `process.env`, so the parser takes the bindings
 * object. One parse means one error listing every problem, rather than
 * discovering missing config one failed request at a time.
 */
export function composeEnv<T extends EnvFragment>(fragments: T) {
  const schema = z.object(fragments);

  return {
    schema,
    parse(raw: Record<string, unknown>): z.infer<typeof schema> {
      const result = schema.safeParse(raw);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Invalid environment: ${issues}`);
      }
      return result.data;
    },
  };
}

/** Assert a secret is present at its point of use, with a message that says
 *  which key to set rather than "undefined is not a function" three frames on. */
export function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}

export { z };
