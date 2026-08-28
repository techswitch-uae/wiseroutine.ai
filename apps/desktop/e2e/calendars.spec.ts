import { dayShown, expect, test, todayNoon } from "./support";

/**
 * The walking skeleton: one scenario, end to end, through every layer.
 *
 * Browser → Vite app → Worker → libSQL and back. Nothing is mocked. This is
 * the shape every later scenario takes, and it is deliberately the one that
 * caught a real bug: unticking a calendar cancelled its future syncs but left
 * every event already fetched in the table, so the meeting stayed on the day
 * no matter how often it was reloaded.
 */

const NOON = todayNoon();
const MEETING = { title: "Design review", startsAt: NOON, endsAt: NOON + 3_600_000 };

test("a meeting from a connected calendar shows on the day", async ({
  page,
  signIn,
}) => {
  await signIn([{ name: "Work", isPrimary: true, events: [MEETING] }]);

  await page.goto("/");

  // If the token key ever drifts from the app's, this is where it shows: the
  // route guard bounces to /signin before anything else runs.
  await expect(page).not.toHaveURL(/signin/);
  await expect(page.getByText(MEETING.title)).toBeVisible();
});

test("unticking a calendar takes its meetings off the day", async ({
  page,
  signIn,
}) => {
  await signIn([{ name: "Work", isPrimary: true, events: [MEETING] }]);

  await page.goto("/");
  await expect(page.getByText(MEETING.title)).toBeVisible();

  await page.goto("/calendars");
  await page.getByRole("checkbox", { name: "Work" }).uncheck();

  // Update is what applies the ticks and asks for a sync — the ticks alone
  // change nothing, which is the behaviour being asserted.
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("button", { name: "Update" })).toBeHidden();

  await page.goto("/");
  // The day has to be on screen before an absence means anything.
  await dayShown(page);
  await expect(page.getByText(MEETING.title)).toBeHidden();
});

test("the set-up module is offered only until a calendar is connected", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Connect/ })).toBeVisible();

  // Dismissing is permanent, and is the other way out of the module.
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeHidden();

  await page.reload();
  await dayShown(page);
  await expect(page.getByRole("button", { name: "Skip for now" })).toBeHidden();
});
