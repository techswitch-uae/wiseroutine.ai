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

/** Create an activity without going near the UI, so what a scenario opens
 *  Today with is not also a scenario about the Activities page. */
async function seedActivity(
  token: string,
  input: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${API_URL}/activities`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`could not seed an activity: ${response.status}`);
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

/** The configuration sheet, whichever job opened it. */
const sheet = (page: Page): Locator => page.getByRole("dialog");

/** Pick a template, take whatever it suggests, and add it. */
async function add(page: Page, name: string): Promise<void> {
  await libraryChip(page, name).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet(page)).toBeHidden();
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

test("free keeps two, and removing one makes room for another", async ({
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

  // Remove is the only way out for now. Pausing would keep the activity and
  // free the place, and it is going to be a Pro capability - so it is not
  // offered to everyone first and taken away afterwards.
  await activity(page, "Eye rest")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(activity(page, "Eye rest")).toHaveCount(0);
  await expect(page.getByText("1 of 2 used")).toBeVisible();

  await add(page, "Walk");
  await expect(page.getByText("2 of 2 used")).toBeVisible();
});

test("an edit survives a reload, and says Update rather than Add", async ({
  page,
  signIn,
}) => {
  await signIn();
  await openActivities(page);
  await add(page, "Shoulder stretch");

  await activity(page, "Shoulder stretch")
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(sheet(page)).toBeVisible();
  // Which job the sheet is doing is said on its one committing button.
  await expect(
    sheet(page).getByRole("button", { name: "Add", exact: true }),
  ).toHaveCount(0);

  await sheet(page).getByRole("button", { name: "How long: more" }).click();
  await sheet(page).getByRole("button", { name: "Mornings" }).click();
  await sheet(page).getByRole("button", { name: "Update" }).click();
  await expect(sheet(page)).toBeHidden();

  await page.reload();
  await expect(
    activity(page, "Shoulder stretch").getByText(
      "15 min · 3 × day · Every day · mornings",
    ),
  ).toBeVisible();
});

/* ── Which days it runs on ───────────────────────────────────────────────── */

test("days are picked in the sheet, read back in words, and enforced", async ({
  page,
  signIn,
}) => {
  await signIn();
  await openActivities(page);

  await libraryChip(page, "Walk").click();
  // Every day to begin with - the default nearly everything keeps.
  await expect(sheet(page).getByText("Every day")).toBeVisible();

  await sheet(page).getByRole("button", { name: "Saturday" }).click();
  await sheet(page).getByRole("button", { name: "Sunday" }).click();
  await expect(sheet(page).getByText("Weekdays")).toBeVisible();

  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    activity(page, "Walk").getByText("15 min · 1 × day · Weekdays"),
  ).toBeVisible();
});

test("an activity on no days cannot be saved", async ({ page, signIn }) => {
  await signIn();
  await openActivities(page);
  await libraryChip(page, "Eye rest").click();

  for (const day of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]) {
    await sheet(page).getByRole("button", { name: day }).click();
  }

  // It would be placed on no day and say nothing about it.
  await expect(sheet(page).getByText("No days picked")).toBeVisible();
  await expect(
    sheet(page).getByRole("button", { name: "Add", exact: true }),
  ).toBeDisabled();
});

/* ── On the day ──────────────────────────────────────────────────────────── */

test("an added activity is planned onto today", async ({ page, signIn }) => {
  await signIn(CALENDARS);
  await openActivities(page);
  await add(page, "Shoulder stretch");

  await page.goto("/");
  await dayShown(page);

  // The whole day is planned whatever the clock says, so this holds at nine in
  // the evening as well as at nine in the morning - which is the bug that
  // started this: an activity added after six placed nothing, and Today drew
  // an empty ruler with no explanation on it.
  await expect(
    page.locator(".wr-daygrid-item", { hasText: "Shoulder stretch" }).first(),
  ).toBeVisible();
});

test("opening the day places the activities, with nobody having asked", async ({
  page,
  signIn,
}) => {
  const user = await signIn(CALENDARS);

  // Straight into the database, and nothing plans it. Days ahead are never
  // filled in, so until someone opens this day there is nothing on it.
  await seedActivity(user.token, {
    name: "Eye rest",
    sessionMinutes: 5,
    minimumType: "countPerDay",
    minimumValue: 2,
  });

  await page.goto("/");
  await dayShown(page);

  await expect(
    page.locator(".wr-daygrid-item", { hasText: "Eye rest" }),
  ).toHaveCount(2);
});

test("a day already planned is not re-planned when it is opened again", async ({
  page,
  signIn,
}) => {
  const user = await signIn(CALENDARS);
  await seedActivity(user.token, {
    name: "Eye rest",
    sessionMinutes: 5,
    minimumType: "countPerDay",
    minimumValue: 1,
  });

  await page.goto("/");
  await dayShown(page);
  const placed = page.locator(".wr-daygrid-item", { hasText: "Eye rest" });
  await expect(placed).toHaveCount(1);

  // Moved by hand, then the day is opened again. A second plan would put it
  // back where the planner wanted it, which is the whole reason a day is
  // decided once rather than on every load.
  await placed.focus();
  await page.keyboard.press("ArrowDown");
  const moved = await placed.getAttribute("aria-label");

  await page.reload();
  await dayShown(page);
  await expect(placed).toHaveAttribute("aria-label", moved as string);
});

test("dragging a slot to the edge scrolls the day along with it", async ({
  page,
  signIn,
}) => {
  const user = await signIn(CALENDARS);
  // Enough activity to fill the day past the height of its own scroller, so
  // there is somewhere to scroll to.
  await seedActivity(user.token, {
    name: "Eye rest",
    sessionMinutes: 5,
    minimumType: "countPerDay",
    minimumValue: 6,
  });

  await page.goto("/");
  await dayShown(page);

  const scroller = page.locator(".wr-page-scroll");
  const block = page.locator(".wr-daygrid-item-movable").first();
  await expect(block).toBeVisible();

  const before = await scroller.evaluate((el) => el.scrollTop);
  const box = (await block.boundingBox()) as { x: number; y: number };
  const frame = (await scroller.boundingBox()) as { y: number; height: number };

  // Real mouse events, because this is the one part of the drag the browser
  // has to be doing for itself: `requestAnimationFrame` does not run in a page
  // nobody is rendering, so the scroll loop cannot be exercised any other way.
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  // Park inside the bottom edge zone and stop, the way a pointer does when it
  // runs out of screen. Nothing moves from here on; the day has to come to it.
  await page.mouse.move(box.x + 40, frame.y + frame.height - 10, { steps: 10 });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 4000 })
    .toBeGreaterThan(before + 40);

  await page.mouse.up();
});

test("once set up, the wizard is gone for good - even with the activities removed", async ({
  page,
  signIn,
}) => {
  const user = await signIn(CALENDARS);
  await seedActivity(user.token, { name: "Eye rest", sessionMinutes: 5 });
  await seedActivity(user.token, { name: "Walk", sessionMinutes: 15 });

  // Two of three already true, so only the hours are left to look at.
  await page.goto("/");
  await dayShown(page);
  await expect(progress(page)).toHaveText("2 of 3");
  await step(page, "Confirm working hours")
    .getByRole("button", { name: "Check my hours" })
    .click();
  await expect(page).toHaveURL(/day-view-hours$/);

  await page.goto("/");
  await dayShown(page);
  await expect(setUp(page)).toHaveCount(0);

  // Now undo the thing a step was checking. A checklist would come straight
  // back and walk someone who has been using the app for months through
  // getting started; a wizard remembers that it already ran.
  await openActivities(page);
  for (const name of ["Eye rest", "Walk"]) {
    await activity(page, name).getByRole("button", { name: "Remove" }).click();
    await expect(activity(page, name)).toHaveCount(0);
  }

  await page.goto("/");
  await dayShown(page);
  await expect(setUp(page)).toHaveCount(0);

  // And it survives the window being closed, which is the whole point of
  // recording it rather than holding it in state.
  await page.reload();
  await dayShown(page);
  await expect(setUp(page)).toHaveCount(0);
});

/* ── Keys on a slot ──────────────────────────────────────────────────────── */

test("Delete takes a slot off today, and the toast puts it back", async ({
  page,
  signIn,
}) => {
  const user = await signIn(CALENDARS);
  await seedActivity(user.token, {
    name: "Eye rest",
    sessionMinutes: 5,
    minimumType: "countPerDay",
    minimumValue: 1,
  });

  await page.goto("/");
  await dayShown(page);
  const slot = page.locator(".wr-daygrid-item", { hasText: "Eye rest" });
  await expect(slot).toHaveCount(1);

  await slot.focus();
  await page.keyboard.press("Delete");
  await expect(slot).toHaveCount(0);

  // The whole reason the toast carries the undo: this was a destructive action
  // taken on a bare keypress, with no dialog in front of it.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(slot).toHaveCount(1);
});

test("a deleted slot stays gone for today, and only for today", async ({
  page,
  signIn,
}) => {
  const user = await signIn(CALENDARS);
  await seedActivity(user.token, {
    name: "Eye rest",
    sessionMinutes: 5,
    minimumType: "countPerDay",
    minimumValue: 1,
  });

  await page.goto("/");
  await dayShown(page);
  const slot = page.locator(".wr-daygrid-item", { hasText: "Eye rest" });
  await slot.focus();
  await page.keyboard.press("Delete");
  await expect(slot).toHaveCount(0);

  // Opening the day re-plans anything missing from it, so this is the test
  // that "off today" is not silently undone a second later: the cancelled slot
  // is still a row, which is what keeps the activity from being re-placed.
  await page.reload();
  await dayShown(page);
  await expect(slot).toHaveCount(0);

  // Tomorrow is a different day and knows nothing about it. Asked of the
  // server directly, because the day view offers no way to walk to another
  // date - and "only for today" is a claim about the plan, not about a screen.
  const tomorrow = await (
    await fetch(`${API_URL}/today?at=${Date.now() + 86_400_000}`, {
      headers: { authorization: `Bearer ${user.token}` },
    })
  ).json();
  expect(
    (tomorrow as { slots: { title: string }[] }).slots.map((s) => s.title),
  ).toContain("Eye rest");
});
