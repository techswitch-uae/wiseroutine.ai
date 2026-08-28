import { expect, test as base } from "@playwright/test";

/**
 * What a scenario needs before it can start clicking.
 *
 * Two things the app cannot be asked to do in a test: sign in, which is a code
 * emailed to a real address, and connect a calendar, which is a consent screen
 * on Google's servers. Both go through the Worker's seeding routes instead —
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
  // 204 from /reset — there is nothing to parse, and asking anyway throws.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Nothing left over from the last scenario.
 *
 * Not optional: locally one database serves every user, so without this a
 * scenario sees whatever the previous one seeded. That is not a quirk of the
 * fixture — it is what the first run of these tests actually did.
 */
base.beforeEach(async () => {
  await seed("/reset", {});
});

export const test = base.extend<{
  /** A signed-in user, already in the browser's storage. */
  signIn: (calendars?: SeedCalendar[]) => Promise<SeededUser>;
}>({
  signIn: async ({ page }, use) => {
    await use(async (calendars) => {
      // The seeded user lives in this machine's zone, so "noon" means the
      // same thing to the test and to the server. Left at a fixed zone, a
      // meeting placed at local noon lands outside the working window
      // whenever the runner is a few hours from it — which is a failure with
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
 * Noon today, in the seeded user's zone — which is this machine's.
 *
 * Today, not tomorrow: the day view asks the server for the current day and
 * offers no way to look at another one, so a meeting seeded anywhere else is
 * simply not on the screen under test.
 *
 * Noon, not "now": the working window is 09:00–17:00, and a suite that runs
 * in the evening would place its meeting outside it and fail for a reason
 * that has nothing to do with the code. Midday is inside the window whatever
 * time the tests are actually run.
 */
export function todayNoon(): number {
  const at = new Date();
  at.setHours(12, 0, 0, 0);
  return at.getTime();
}

/**
 * Wait until the day has actually rendered.
 *
 * Absence assertions are worthless without this. `toBeHidden()` is satisfied
 * by an element that does not exist, and immediately after a navigation
 * nothing exists yet — so a test asserting "the meeting is gone" passed
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
