import type { Locator, Page } from "@playwright/test";
import { API_URL } from "./environment";
import { dayShown, expect, meetingAt, test } from "./support";

/**
 * Activities, from an empty account to blocks on the day.
 *
 * Three seams, none of them reachable without the whole stack: that a new
 * account really does start with nothing (it used to be seeded with six, which
 * is three times the free limit), that the free limit is enforced by the
 * server rather than only greyed out here, and that an activity added on one
 * page turns into a slot drawn on another.
 */

const CALENDARS = [
  { name: "Work", isPrimary: true, events: [meetingAt("Design review", 12)] },
];

/** The set-up module, found by the one thing only it has. A `Card` names
 *  itself with a heading but is not a landmark, so there is no role to ask for. */
const setUp = (page: Page): Locator =>
  page.locator(".wr-card", { has: page.locator(".wr-setup-steps") });

const step = (page: Page, label: string): Locator =>
  setUp(page).locator(".wr-setup-step", { hasText: label });

/** How many steps the module says are done. */
const progress = (page: Page): Locator =>
  setUp(page).locator(".wr-setup-count");

/**
 * Working hours that contain whatever time this suite is run at.
 *
 * The planner places from *now* onward, so an account whose working day has
 * already ended has nowhere to put anything - which is correct, and would fail
 * this scenario every evening for a reason that has nothing to do with
 * activities.
 */
async function hoursAroundNow(token: string): Promise<void> {
  const clock = new Date();
  const minutes = clock.getHours() * 60 + clock.getMinutes();
  const response = await fetch(`${API_URL}/settings`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      dayStartMinutes: Math.max(0, minutes - 60),
      dayEndMinutes: Math.min(24 * 60, Math.max(minutes + 120, 120)),
    }),
  });
  if (!response.ok) {
    throw new Error(`could not widen the working day: ${response.status}`);
  }
}

const libraryChip = (page: Page, name: string): Locator =>
  page.locator(".wr-library-chip", { hasText: name });

/** One row in "Yours", addressed by the activity's own name. */
const activity = (page: Page, name: string): Locator =>
  page.locator(".wr-activity-row", { hasText: name });

async function openActivities(page: Page): Promise<void> {
  await page.goto("/activities");
  await expect(
    page.getByRole("heading", { name: "Add an activity" }),
  ).toBeVisible();
}

/** Pick a template, take whatever it suggests, and add it. */
async function add(page: Page, name: string): Promise<void> {
  await libraryChip(page, name).click();
  await page.getByRole("button", { name: "Add activity" }).click();
  await expect(activity(page, name)).toBeVisible();
}

/* ── Setting up ──────────────────────────────────────────────────────────── */

test("the set-up module lists three real steps and cannot be skipped", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/");
  await dayShown(page);

  await expect(step(page, "Connect a calendar")).toBeVisible();
  await expect(step(page, "Add two activities")).toBeVisible();
  await expect(step(page, "Confirm working hours")).toBeVisible();

  // Every step is something the app cannot work without, so there is no way
  // out but finishing. "Skip for now" bought a blank day with no explanation.
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(
    0,
  );
  await expect(progress(page)).toHaveText("0 of 3");
});

test("a connected calendar ticks its own step, and activities tick theirs", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);
  await page.goto("/");
  await dayShown(page);

  // The calendar step is satisfied by the connection, not by being pressed.
  await expect(step(page, "Connect a calendar")).toHaveClass(
    /wr-setup-step-done/,
  );
  await expect(progress(page)).toHaveText("1 of 3");

  // The activities step sends you to the page that fixes it.
  await step(page, "Add two activities")
    .getByRole("button", { name: "Add an activity" })
    .click();
  await expect(page).toHaveURL(/\/activities$/);

  await add(page, "Shoulder stretch");
  await add(page, "Eye rest");

  await page.goto("/");
  await dayShown(page);
  await expect(step(page, "Add two activities")).toHaveClass(
    /wr-setup-step-done/,
  );
  await expect(progress(page)).toHaveText("2 of 3");
});

/* ── The library and the limit ───────────────────────────────────────────── */

test("a new account starts with nothing, and the counter says so", async ({
  page,
  signIn,
}) => {
  await signIn();
  await openActivities(page);

  // Six starter activities used to be written into every new database, which
  // made this counter a lie the first time anyone read it.
  await expect(page.getByText("0 of 2 used")).toBeVisible();
  await expect(page.locator(".wr-activity-row")).toHaveCount(0);
});

test("free keeps two, and pausing one makes room for another", async ({
  page,
  signIn,
}) => {
  await signIn();
  await openActivities(page);

  await add(page, "Shoulder stretch");
  await add(page, "Eye rest");
  await expect(page.getByText("2 of 2 used")).toBeVisible();

  // At the limit the whole palette is refused, not each chip in turn.
  await expect(libraryChip(page, "Walk")).toBeDisabled();
  await expect(page.getByText("Free keeps two active at a time")).toBeVisible();

  // Pausing is the swap the note talks about: it frees a place and keeps the
  // activity, where removing would not.
  await activity(page, "Eye rest")
    .getByRole("button", { name: "Pause" })
    .click();
  await expect(activity(page, "Eye rest").getByText("Paused")).toBeVisible();
  await expect(page.getByText("1 of 2 used")).toBeVisible();

  await add(page, "Walk");
  await expect(page.getByText("2 of 2 used")).toBeVisible();
});

test("an edit survives a reload", async ({ page, signIn }) => {
  await signIn();
  await openActivities(page);
  await add(page, "Shoulder stretch");

  await activity(page, "Shoulder stretch")
    .getByRole("button", { name: "Edit" })
    .click();
  await page.getByRole("button", { name: "How long: more" }).click();
  await page.getByRole("button", { name: "Mornings" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.reload();
  await expect(
    activity(page, "Shoulder stretch").getByText("15 min · 3 × day · mornings"),
  ).toBeVisible();
});

/* ── On the day ──────────────────────────────────────────────────────────── */

test("an added activity is planned onto today", async ({ page, signIn }) => {
  const user = await signIn(CALENDARS);
  await hoursAroundNow(user.token);
  await openActivities(page);
  await add(page, "Shoulder stretch");

  await page.goto("/");
  await dayShown(page);

  // Planned by the server after the activity was created - the day is the
  // only place the whole chain can be seen to have worked.
  await expect(
    page.locator(".wr-daygrid-item", { hasText: "Shoulder stretch" }).first(),
  ).toBeVisible();
});
