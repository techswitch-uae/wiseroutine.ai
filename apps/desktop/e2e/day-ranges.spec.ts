import type { Locator, Page } from "@playwright/test";
import { dayShown, expect, meetingAt, test } from "./support";

/**
 * Which hours the day shows, across the two screens that decide it.
 *
 * Every rule here needs both: the range is configured in Settings, resolved by
 * the Worker, and drawn on Today, and the interesting failures all live in
 * those seams rather than in any one of them. `dayRanges.test.ts` covers
 * deriving the ranges, `api.test.ts` covers what `/today` returns for one -
 * neither can tell you that a switch saved itself, that a reload kept it, or
 * that a sync did not quietly put the day back on yesterday's answer.
 *
 * The seeded user starts on the defaults: 08:00–18:00 working hours, no custom
 * range, opening on working hours, outside meetings summarised. Every hour
 * below is written against that.
 */

/** One meeting before the working window, one inside, one after. Enough to
 *  tell any two ranges apart by what is on the screen. */
const EARLY = meetingAt("Early standup", 7);
const MIDDAY = meetingAt("Design review", 12);
const EVENING = meetingAt("Studio session", 19);

const CALENDARS = [
  { name: "Work", isPrimary: true, events: [EARLY, MIDDAY, EVENING] },
];

/**
 * The window the day says it is showing.
 *
 * Read off the header rather than counted off the ruler: the gutter's labels
 * are quarter-hours and a range is only ever named once, next to the date.
 */
const hoursShown = (page: Page): Locator => page.locator(".wr-page-helper");

/** The hours picker, opened. */
async function openPicker(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Hours shown" }).click();
}

/** Everything inside one settings block, addressed by its own heading - which
 *  is the only way to say *which* Update, now that each block has one. */
const block = (page: Page, name: string): Locator =>
  page.getByRole("region", { name });

/** Go to Settings and wait for the section to be driveable. */
async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(block(page, "Working hours")).toBeVisible();
}

/* ── Meetings the range leaves out ───────────────────────────────────────── */

test("meetings outside the range are summarised, and the switch decides it", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await page.goto("/");
  await expect(page.getByText(MIDDAY.title)).toBeVisible();
  // On by default: the two edges say what the working window is not showing.
  await expect(page.getByText(/1 meeting before 08:00/)).toBeVisible();
  await expect(page.getByText(/1 meeting after 18:00/)).toBeVisible();

  await openSettings(page);
  await page
    .getByRole("switch", { name: "Show meetings outside the range" })
    .click();

  // No Update anywhere: a switch is the decision, so it saves itself. If this
  // ever regresses the day below simply will not have changed.
  await expect(page.getByRole("button", { name: "Update" })).toBeHidden();

  await page.goto("/");
  await dayShown(page);
  await expect(page.getByText(MIDDAY.title)).toBeVisible();
  await expect(page.getByText(/meetings? before/)).toBeHidden();
  await expect(page.getByText(/meetings? after/)).toBeHidden();

  // Hidden, not lost: the full day still has all three.
  await openPicker(page);
  await page.getByRole("menuitemradio", { name: /Full day/ }).click();
  await expect(page.getByText(EARLY.title)).toBeVisible();
  await expect(page.getByText(EVENING.title)).toBeVisible();
});

test("an edge line widens the day to the whole of it", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await page.goto("/");
  await page.getByRole("button", { name: "Show the full day" }).first().click();

  await expect(hoursShown(page)).toHaveText("00:00–24:00");
  await expect(page.getByText(EARLY.title)).toBeVisible();
  await expect(page.getByText(EVENING.title)).toBeVisible();
  // Nothing is outside the whole day, so there is nothing left to summarise.
  await expect(page.getByText(/meetings? before/)).toBeHidden();
});

/* ── Setting the ranges ──────────────────────────────────────────────────── */

test("changing the working hours moves the window the day draws", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await openSettings(page);
  const working = block(page, "Working hours");
  await working.getByLabel("Working hours start").fill("13:00");
  await working.getByLabel("Working hours end").fill("17:00");

  // Typed values wait for a press, and the press belongs to this block.
  await working.getByRole("button", { name: "Update" }).click();
  await expect(working.getByRole("button", { name: "Update" })).toBeHidden();

  await page.goto("/");
  await expect(hoursShown(page)).toHaveText("13:00–17:00");
  // Midday used to be inside the window and now is not, which is the whole
  // point: the summary follows the window rather than a fixed hour.
  await expect(page.getByText(MIDDAY.title)).toBeHidden();
  await expect(page.getByText(/2 meetings before 13:00/)).toBeVisible();
});

test("the custom range exists the moment the switch is on", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await openSettings(page);
  const custom = block(page, "Custom range");
  await custom.getByRole("switch", { name: "Use a custom range" }).click();

  // Nothing to commit, because there is nothing left uncommitted: the switch
  // saved a range along with itself.
  await expect(custom.getByRole("button", { name: "Update" })).toBeHidden();

  // The report this test is written from, step for step: turn it on, go to
  // the day, and it was not in the picker - because the switch had only moved
  // on screen and was waiting for an Update nobody knew to press.
  await page.goto("/");
  await openPicker(page);
  await expect(
    page.getByRole("menuitemradio", { name: /Evenings 17:00–22:00/ }),
  ).toBeVisible();
});

test("a custom range reaches the picker and narrows the day", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await openSettings(page);
  const custom = block(page, "Custom range");
  await custom.getByRole("switch", { name: "Use a custom range" }).click();

  // Switched on with a range already in it. A switch that needed a second
  // press to exist is how the range went missing from the picker.
  await expect(custom.getByLabel("Custom range name")).toHaveValue("Evenings");

  await custom.getByLabel("Custom range name").fill("Studio evenings");
  await custom.getByLabel("Custom range start").fill("18:30");
  await custom.getByLabel("Custom range end").fill("22:00");
  await custom.getByRole("button", { name: "Update" }).click();
  await expect(custom.getByRole("button", { name: "Update" })).toBeHidden();

  await page.goto("/");
  await openPicker(page);
  await page
    .getByRole("menuitemradio", { name: /Studio evenings 18:30–22:00/ })
    .click();

  await expect(hoursShown(page)).toHaveText("18:30–22:00");
  await expect(page.getByText(EVENING.title)).toBeVisible();
  await expect(page.getByText(MIDDAY.title)).toBeHidden();
  await expect(page.getByText(/2 meetings before 18:30/)).toBeVisible();
});

test("the ranges are still there after a reload", async ({ page, signIn }) => {
  await signIn(CALENDARS);

  await openSettings(page);
  await page.getByRole("switch", { name: "Use a custom range" }).click();
  const custom = block(page, "Custom range");
  await custom.getByLabel("Custom range name").fill("On call");
  await custom.getByRole("button", { name: "Update" }).click();
  await expect(custom.getByRole("button", { name: "Update" })).toBeHidden();

  // Settings reads the range back from the session rather than from anything
  // it kept in memory, so a reload is what proves the write landed.
  await page.reload();
  await expect(
    block(page, "Custom range").getByLabel("Custom range name"),
  ).toHaveValue("On call");

  await page.goto("/");
  await openPicker(page);
  await expect(
    page.getByRole("menuitemradio", { name: /On call/ }),
  ).toBeVisible();
});

/* ── Which one the day opens on ──────────────────────────────────────────── */

test("the day opens on the range the settings name", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await openSettings(page);
  const opens = block(page, "Day opens on");
  await opens.getByRole("button", { name: "Full day" }).click();

  await page.goto("/");
  // Nothing was touched on this screen - the day arrived this way.
  await expect(hoursShown(page)).toHaveText("00:00–24:00");
  await expect(page.getByText(EARLY.title)).toBeVisible();
});

test("the range chosen on the day is looking, not a preference", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await page.goto("/");
  await openPicker(page);
  await page.getByRole("menuitemradio", { name: /Full day/ }).click();
  await expect(hoursShown(page)).toHaveText("00:00–24:00");

  // Switching to the evening to check something is not a decision about every
  // morning after it. That decision lives in Settings, and only there.
  await page.reload();
  await expect(hoursShown(page)).toHaveText("08:00–18:00");
});

test("a day set to open on a range that no longer exists is not blank", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await openSettings(page);
  await page.getByRole("switch", { name: "Use a custom range" }).click();
  await block(page, "Day opens on")
    .getByRole("button", { name: "Custom" })
    .click();

  await page.goto("/");
  await expect(hoursShown(page)).toHaveText("17:00–22:00");

  // Now take the range away underneath the setting that names it.
  await openSettings(page);
  await page.getByRole("switch", { name: "Use a custom range" }).click();

  await page.goto("/");
  // Falls back rather than failing, and rather than resolving to a window
  // nothing fits in - which would look exactly like a day that lost its data.
  await expect(hoursShown(page)).toHaveText("08:00–18:00");
  await expect(page.getByText(MIDDAY.title)).toBeVisible();
  await openPicker(page);
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
});

/* ── Holding still while other things happen ─────────────────────────────── */

test("syncing does not put the day back on another range", async ({
  page,
  signIn,
}) => {
  await signIn(CALENDARS);

  await page.goto("/");
  await openPicker(page);
  await page.getByRole("menuitemradio", { name: /Full day/ }).click();
  await expect(hoursShown(page)).toHaveText("00:00–24:00");

  await page.getByRole("button", { name: /Sync calendars now/ }).click();

  /**
   * A sync reloads the day three times over the ten seconds behind it, and
   * each of those used to reload the range that was on screen when the sync
   * was *asked for*. Switching to the full day and then syncing put the day
   * silently back a second later, which read as the picker ignoring the
   * click. Waiting past the last of them is the only way to catch it.
   */
  await page.waitForTimeout(11_000);
  await expect(hoursShown(page)).toHaveText("00:00–24:00");
  await expect(page.getByText(EARLY.title)).toBeVisible();
});
