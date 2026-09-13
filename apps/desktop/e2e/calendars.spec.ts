import { dayShown, expect, test, todayNoon } from "./support";

// Calendar settings are core: exercise the default all-off release.

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
const MEETING = {
  title: "Design review",
  startsAt: NOON,
  endsAt: NOON + 3_600_000,
};

test("old calendar bookmarks land in Settings with the sidebar still selected", async ({
  page,
  signIn,
}) => {
  await signIn([{ name: "Work", isPrimary: true, events: [MEETING] }]);
  await page.goto("/calendars");
  await expect(page).toHaveURL(/\/settings#calendars$/);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveClass(/wr-navitem-active/);
  const calendars = page.getByRole("region", { name: "Calendars" });
  await expect(
    calendars.getByRole("heading", { name: "Calendars", exact: true }),
  ).toBeInViewport();
  await expect(calendars.getByRole("checkbox", { name: "Work" })).toBeChecked();
  await expect(page.locator(".wr-page-scroll")).toHaveCount(1);
  await calendars.getByRole("checkbox", { name: "Work" }).uncheck();
  await calendars.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(calendars.getByRole("checkbox", { name: "Work" })).toBeChecked();
  await calendars
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await calendars.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(calendars.getByRole("checkbox", { name: "Work" })).toBeChecked();
});

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

  // The day bar answers the question its refresh button exists to ask, and the
  // answer comes from the server - the client cannot know when a calendar was
  // last read, only when *it* last asked.
  await expect(page.locator(".wr-daybar-tools")).toContainText(/Synced/);
});

test("unticking a calendar takes its meetings off the day", async ({
  page,
  signIn,
}) => {
  await signIn([{ name: "Work", isPrimary: true, events: [MEETING] }]);

  await page.goto("/");
  await expect(page.getByText(MEETING.title)).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveClass(/wr-navitem-active/);
  const calendars = page.getByRole("region", { name: "Calendars" });
  await calendars.getByRole("checkbox", { name: "Work" }).uncheck();

  // Update is what applies the ticks and asks for a sync - the ticks alone
  // change nothing, which is the behaviour being asserted.
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("button", { name: "Update" })).toBeHidden();

  await page.goto("/");
  // The day has to be on screen before an absence means anything.
  await dayShown(page);
  await expect(page.getByText(MEETING.title)).toBeHidden();
});

test("the set-up module asks for a calendar until one is connected", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/");
  await dayShown(page);
  await expect(page.getByRole("button", { name: /Connect/ })).toBeVisible();

  // There is no way out but doing it. "Skip for now" used to be the other
  // one, and all it bought was a blank day with nothing on it explaining why.
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(
    0,
  );

  await page.reload();
  await dayShown(page);
  await expect(page.getByRole("button", { name: /Connect/ })).toBeVisible();
});

test("a connected calendar retires the step that asked for it", async ({
  page,
  signIn,
}) => {
  await signIn([{ name: "Work", isPrimary: true, events: [MEETING] }]);
  await page.goto("/");
  await dayShown(page);

  // Satisfied, not pressed: the step is done because the connection exists.
  await expect(page.getByRole("button", { name: /Connect/ })).toHaveCount(0);
});
