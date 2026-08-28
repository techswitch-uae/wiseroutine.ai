import { test as base, expect } from "@playwright/test";

/**
 * What a scenario needs before it can start clicking.
 *
 * Two things the app cannot be asked to do in a test: sign in, which is a code
 * emailed to a real address, and connect a calendar, which is a consent screen
 * on Google's servers. Both go through the Worker's seeding routes instead -
 * see `apps/api/src/routes/testing.ts` for why that is a door with three locks
 * rather than a loosened sign-in.
 */

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8787";
const SECRET = process.env.E2E_SECRET ?? "";

/**
 * Where the app keeps its session token.
 *
 * Must match `TOKEN_KEY` in `src/lib/api.ts`. Copied rather than imported:
 * that module reads `import.meta.env` at load, which Playwright's runner does
 * not provide. A mismatch shows up as every scenario bouncing to /signin, so
 * the first assertion in the smoke test is that we landed on the day.
 */
const TOKEN_KEY = "wiseroutine.session";

export interface SeededUser {
  userId: string;
  token: string;
  email: string;
}

export interface SeedCalendar {
  name: string;
  isSelected?: boolean;
  isPrimary?: boolean;
  events?: { title: string; startsAt: number; endsAt: number }[];
}

async function seed<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}/test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-e2e-key": SECRET,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // A 404 here is nearly always the gate, not a typo in the path: the
    // Worker is running without `E2E_SECRET`, or with a different one.
    throw new Error(
      `seed ${path} failed with ${response.status}. ` +
        "Is the Worker running with the same E2E_SECRET this run is using?",
    );
  }
  // 204 from /reset - there is nothing to parse, and asking anyway throws.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const test = base.extend<{
  /** Nothing left over from the last scenario. It hands the test nothing -
   *  it only has to have run. */
  clean: undefined;
  /** A signed-in user, already in the browser's storage. */
  signIn: (calendars?: SeedCalendar[]) => Promise<SeededUser>;
}>({
  /**
   * Empty both databases before every scenario.
   *
   * Not optional: locally one database serves every user, so without this a
   * scenario sees whatever the previous one seeded. That is not a quirk of the
   * fixture - it is what the first run of these tests actually did.
   *
   * An auto fixture rather than the `beforeEach` this used to be. A hook
   * registered at the top level of an imported module attaches to the suite
   * that happened to import it *first*, and this module is imported by every
   * spec file - so the moment there was a second one, it got no reset at all
   * and quietly inherited the previous file's calendars. It cost an afternoon
   * to find, because the symptom was one duplicated meeting in one assertion
   * and the suite passed whenever that file was run on its own. A fixture
   * belongs to whoever uses it, so this cannot happen again.
   */
  clean: [
    // Playwright reads a fixture's dependencies off the destructuring pattern
    // below, so one that needs none still has to destructure nothing.
    // biome-ignore lint/correctness/noEmptyPattern: required by Playwright
    async ({}, use) => {
      await seed("/reset", {});
      await use(undefined);
    },
    { auto: true },
  ],

  signIn: async ({ page }, use) => {
    await use(async (calendars) => {
      // The seeded user lives in this machine's zone, so "noon" means the
      // same thing to the test and to the server. Left at a fixed zone, a
      // meeting placed at local noon lands outside the working window
      // whenever the runner is a few hours from it - which is a failure with
      // nothing to say about calendars.
      const user = await seed<SeededUser>("/seed", {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      if (calendars?.length) {
        await seed("/calendar", { calendars }, user.token);
      }

      // Put the token where a real sign-in would have left it. `addInitScript`
      // rather than a `page.evaluate` after loading, because the app reads it
      // in `beforeLoad` and would have already bounced to /signin.
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        [TOKEN_KEY, user.token] as const,
      );

      return user;
    });
  },
});

export { expect };

/**
 * A wall-clock hour today, in the seeded user's zone - which is this machine's.
 *
 * Today, not tomorrow: the day view asks the server for the current day and
 * offers no way to look at another one, so a meeting seeded anywhere else is
 * simply not on the screen under test.
 *
 * A fixed hour, not "now": a suite that runs in the evening would otherwise
 * place its meeting wherever the clock happened to be and fail for a reason
 * that has nothing to do with the code. Every window a test asserts against
 * is written in these same hours, so the two cannot drift apart.
 */
export function todayAt(hour: number, minute = 0): number {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  return at.getTime();
}

/** Midday - inside the default 08:00–18:00 working window whatever time the
 *  tests are actually run. */
export const todayNoon = (): number => todayAt(12);

/** Half an hour from `hour`, which is long enough to be a meeting and short
 *  enough that two of them fit inside any window a test sets. */
export const meetingAt = (title: string, hour: number, minute = 0) => ({
  title,
  startsAt: todayAt(hour, minute),
  endsAt: todayAt(hour, minute) + 1_800_000,
});

/**
 * Wait until the day has actually rendered.
 *
 * Absence assertions are worthless without this. `toBeHidden()` is satisfied
 * by an element that does not exist, and immediately after a navigation
 * nothing exists yet - so a test asserting "the meeting is gone" passed
 * whether or not it was, which is exactly what this skeleton's first
 * falsification run caught it doing.
 *
 * The sync control is the anchor: it is in the day's header, it is always
 * there once the plan has loaded, and it is never there while it is loading.
 */
export async function dayShown(page: import("@playwright/test").Page) {
  await expect(
    page.getByRole("button", { name: /Sync calendars now|Syncing/ }),
  ).toBeVisible();
}
