import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { release } from "../src/lib/release";

// Per-test contexts isolate each story. Collect browser errors for every test,
// not just the smoke test, so a passing DOM assertion cannot hide hydration errors.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  // Wait for hydration by exercising the real event handler, then reset. There
  // are no sleeps, networkidle waits, synthetic clocks or mocked product APIs.
  await page.getByRole("button", { name: "Extend team check-in" }).click();
  await expect(
    page.getByRole("button", { name: "Restore sample day" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore sample day" }).click();
  await expect(
    page.getByRole("button", { name: "Extend team check-in" }),
  ).toBeVisible();
  // The afterEach assertion sees errors from the whole test.
  browserErrors.set(page, errors);
});

const browserErrors = new WeakMap<object, string[]>();
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("the sample leads, signup stays available and free limits are clear", async ({
  page,
}) => {
  await expect(page).toHaveTitle(/Wise Routine.*Make room for what matters/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your day changes.Your routine comes with it.",
  );
  const hero = page.locator(".hero");
  await expect(
    hero.getByRole("link", { name: "Try a sample day" }),
  ).toHaveAttribute("href", "#demo");
  await expect(
    hero.getByText("No signup needed for the sample day."),
  ).toBeVisible();
  await expect(
    hero.getByRole("link", { name: "Create an account" }),
  ).toHaveAttribute("href", release.signupUrl);
  await expect(hero.locator(".site-button")).toHaveAttribute("href", "#demo");
  await expect(page.locator("#free")).toContainText(
    "3 active activities, with daily repeats",
  );
  await expect(page.locator("#free")).toContainText("No credit card required");
  await expect(
    page.locator(`#free a[href="${release.signupUrl}"]`),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Desktop availability" }).click();
  await expect(page).toHaveURL(/#get-the-app$/);
  const downloads = page.locator("#get-the-app");
  await expect(downloads.getByRole("heading")).toBeInViewport();
  if (release.status === "preview") {
    await expect(downloads).toContainText(
      "Desktop downloads are getting ready.",
    );
    await expect(
      downloads.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", release.signupUrl);
    await expect(page.getByRole("link", { name: /^Download for/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Launch integrations · validation in progress"),
    ).toBeVisible();
  } else {
    for (const download of release.downloads) {
      await expect(
        downloads.getByRole("link", {
          name: `Download for ${download.platform}`,
        }),
      ).toHaveAttribute("href", download.url);
      await expect(downloads.getByText(download.requirements)).toBeVisible();
    }
  }
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("account links hand off to existing signup without making the sample require an account", async ({
  page,
}) => {
  // Test the navigation boundary without contacting production or pretending
  // a fixture response creates an account. Email verification belongs to the
  // existing /signin app and its live-email acceptance checks.
  await page.route(release.signupUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "Existing account app boundary — test fixture, not a signup",
    }),
  );
  for (const [section, label] of [
    ["header", "Sign in"],
    [".hero", "Create an account"],
    ["#get-the-app", "Create an account"],
  ] as const) {
    await page.goto("/");
    const link = page
      .locator(section)
      .getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", release.signupUrl);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(release.signupUrl);
  }
});

test("meeting change → automatic repair → unaffected walk stays put → replay", async ({
  page,
}) => {
  const focus = page.getByTestId("slot-focus");
  const walk = page.getByTestId("slot-walk");
  await expect(focus).toHaveAttribute("aria-label", "Deep work, 09:30–10:15");
  const walkBefore = await walk.getAttribute("aria-label");
  if (!walkBefore)
    throw new Error("The sample walk has no accessible time range");
  await page.getByRole("button", { name: "Extend team check-in" }).click();
  await expect(page.getByTestId("meeting-check-in")).toHaveAttribute(
    "aria-label",
    "Team check-in, 09:00–09:50",
  );
  await expect(focus).toHaveAttribute("aria-label", /moved automatically/);
  await expect(focus).not.toHaveAttribute("aria-label", /09:30/);
  await expect(walk).toHaveAttribute("aria-label", walkBefore);
  await expect(page.getByRole("status")).toContainText(
    "Your walk stays at 10:15.",
  );
  await expect(page.getByRole("status")).toContainText(
    "Only the affected block moves.",
  );
  await page.getByRole("button", { name: "Restore sample day" }).click();
  await expect(focus).toHaveAttribute("aria-label", "Deep work, 09:30–10:15");
  await expect(walk).toHaveAttribute("aria-label", walkBefore);
});

test("a full day keeps unplaced activities visible and offers a way back", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Extend team check-in" }).click();
  await page.getByRole("button", { name: "What if nothing fits?" }).click();
  await expect(page.getByRole("status")).toContainText("No room left.");
  const unplaced = page.getByRole("list", {
    name: "Activities that could not fit",
  });
  await expect(unplaced.getByRole("listitem")).toHaveText([
    "Deep work · Not placed",
    "Walk · Not placed",
  ]);
  await expect(page.getByTestId("slot-focus")).toHaveCount(0);
  await expect(page.getByTestId("slot-walk")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore sample day" }).click();
  await expect(page.getByTestId("slot-focus")).toBeVisible();
  await expect(page.getByTestId("slot-walk")).toBeVisible();
  await expect(unplaced).toHaveCount(0);
});

test("FAQs disclose repeat limits, read-only calendars, and meeting privacy", async ({
  page,
}) => {
  for (const [question, answer] of [
    [
      "What counts as one activity?",
      "Repeating it during the day doesn’t use another activity slot.",
    ],
    [
      "Does it change my Google or Outlook calendar?",
      "doesn’t move your meetings or write activities back",
    ],
    [
      "Do I have to share meeting details?",
      "removes previously saved meeting details",
    ],
    ["Is it free?", "upgrading will be your choice"],
  ] as const) {
    const summary = page.locator("summary", { hasText: question });
    await summary.click();
    await expect(page.getByText(answer, { exact: false })).toBeVisible();
    await summary.click();
    await expect(page.getByText(answer, { exact: false })).toBeHidden();
  }
});

test("keyboard users can skip navigation, operate the demo and open questions", async ({
  page,
  browserName,
}) => {
  // macOS Safari's default Tab omits links. Option+Tab is its native full
  // keyboard gesture; Linux WebKit uses ordinary Tab, like the other engines.
  const tab =
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";
  await page.reload();
  await page.keyboard.press(tab);
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  const extend = page.getByRole("button", { name: "Extend team check-in" });
  // Reach it by tabbing from the skip target; don't programmatically focus a
  // control that might not be reachable through normal keyboard navigation.
  for (
    let i = 0;
    i < 8 &&
    !(await extend.evaluate((node) => node === document.activeElement));
    i++
  ) {
    await page.keyboard.press(tab);
  }
  await expect(extend).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Your walk stays");
  const summary = page.locator("summary").first();
  for (
    let i = 0;
    i < 8 &&
    !(await summary.evaluate((node) => node === document.activeElement));
    i++
  ) {
    await page.keyboard.press(tab);
  }
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("details").first()).toHaveAttribute("open", "");
});

test("WCAG checks pass in initial, changed, full-day and FAQ states", async ({
  page,
}) => {
  const audit = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  };
  await audit();
  await page.getByRole("button", { name: "Extend team check-in" }).click();
  await audit();
  await page.getByRole("button", { name: "What if nothing fits?" }).click();
  await page.locator("summary").nth(3).click();
  await audit();
});

test("small viewports and reduced motion keep the whole flow usable", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 640, 800, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const button = page.getByRole("button", { name: "Extend team check-in" });
    await button.click();
    await expect(page.getByRole("status")).toContainText("Your walk stays");
    await page.getByRole("button", { name: "Restore sample day" }).click();
    if (width === 390 || width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath(`landing-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("auto");
});

test("all on-page CTAs resolve and demo interaction sends no data away", async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== baseURL) external.push(request.url());
  });
  const targets = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")?.slice(1)),
    );
  for (const id of targets)
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  await page.getByRole("link", { name: "Try a sample day" }).click();
  await expect(page).toHaveURL(/#demo$/);
  await page.getByRole("button", { name: "Extend team check-in" }).click();
  await expect(page.getByRole("status")).toContainText("Your walk stays");
  expect(external).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});
