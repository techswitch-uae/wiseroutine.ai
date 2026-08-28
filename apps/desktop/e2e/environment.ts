/**
 * The stack a scenario runs against, which is nobody else's.
 *
 * Every port here is the suite's own. The run used to borrow whatever the
 * developer had running - `pnpm api` on 8787 and `pnpm dev` on 41000, both
 * pointed at the file-backed libSQL databases in `.turso-local` - and that
 * made the tests a side effect on the machine rather than a thing that
 * happened and finished:
 *
 *   · `/test/reset` empties both databases before every scenario, so a run
 *     signed the developer out of their own dev session and deleted their
 *     calendars.
 *   · Locally `TURSO_USER_HOST` is one http:// endpoint, so every user's
 *     database resolves to the *same* file. The last scenario's seeded
 *     "cal@e2e.invalid" therefore belonged to whoever signed in next, who then
 *     found a calendar they had never connected and a sync that failed every
 *     time the window regained focus.
 *   · The reset runs before each scenario and not after, so the last one's
 *     fixtures outlive the run by design.
 *
 * None of that is fixable by resetting harder. It is fixable by not sharing
 * the database, which is what `globalSetup` does: two in-memory `turso dev`
 * servers that exist for the run and die with it. The same reasoning, and
 * almost the same code, as `apps/api/vitest.globalSetup.ts`.
 */

/** One band, so "is this the test stack?" is answerable at a glance. */
export const PORTS = {
  directory: 41190,
  user: 41191,
  api: 41192,
  app: 41193,
} as const;

export const DIRECTORY_URL = `http://127.0.0.1:${PORTS.directory}`;
export const USER_URL = `http://127.0.0.1:${PORTS.user}`;
export const API_URL = `http://localhost:${PORTS.api}`;
export const APP_URL = `http://localhost:${PORTS.app}`;

/**
 * The key the seeding routes are behind.
 *
 * Fixed rather than secret: it only ever unlocks a Worker this config started,
 * against a database that only exists for the run. The value still has to
 * clear the 16-character floor `@wiseroutine/env` puts on it, which a shorter
 * one fails at the first request with a message about the *environment* rather
 * than about the key.
 */
export const E2E_SECRET = "e2e-local-secret-not-a-real-one";
