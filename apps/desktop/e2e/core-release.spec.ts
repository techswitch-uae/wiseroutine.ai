import { API_URL } from "./environment";
import { dayShown, expect, meetingAt, setFeatures, test } from "./support";

test("core-only shell, deep links and activity creation expose no later milestone", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await dayShown(page);
  for (const name of [
    "Inbox",
    "Addons",
    "Week",
    "Month",
    "Year",
    "Quick add",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Quick add" })).toHaveCount(0);
  for (const path of ["/inbox", "/addons", "/week", "/month"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await dayShown(page);
  }
  expect(
    requests.some((url) =>
      ["/inbox", "/todos", "/addons", "/addons/available"].some(
        (path) => url === `${API_URL}${path}`,
      ),
    ),
  ).toBe(false);
  // No addon assets execute or download on M0.
  expect(requests.some((path) => path.endsWith("/addon.js"))).toBe(false);
  await page.goto("/activities");
  for (const name of [
    "Stretch",
    "Eye rest",
    "Walk",
    "Deep work",
    "Breathing",
    "Water",
  ]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^${name} \\d+ min$`) }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Something else", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New activity" });
  await expect(
    dialog.getByText("When it should land", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByText(/When this is on/)).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Name" }).fill("Core focus");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Pause|Resume)$/ }),
  ).toHaveCount(0);
  await page.goto("/settings");
  await expect(
    page
      .getByRole("region", { name: "Calendars" })
      .getByRole("heading", { name: "Connect a calendar" }),
  ).toBeVisible();
  await expect(page.getByText("Custom range", { exact: true })).toHaveCount(0);
  const response = await page.request.post(`${API_URL}/capture`, {
    headers: { authorization: `Bearer ${user.token}` },
    data: {},
  });
  expect(response.status()).toBe(404);
  await page.setViewportSize({ width: 800, height: 650 });
  await page.goto("/");
  await dayShown(page);
  await page.screenshot({ path: "/tmp/wr-core-release.png" });
});

test("core Today offers working hours and the full day without advanced controls", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/");
  await dayShown(page);
  await page.getByRole("button", { name: "Hours shown" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await expect(page.getByRole("group", { name: "Density" })).toHaveCount(0);
  await page.getByRole("menuitemradio", { name: /Full day/ }).click();
  await expect(page.locator(".wr-page-helper")).toHaveText("00:00–24:00");
  await page.getByRole("button", { name: "Sync calendars now" }).click();
  await expect(page.locator(".wr-page-helper")).toHaveText("00:00–24:00");
  for (const destination of ["Settings", "Activities"]) {
    await page.getByRole("button", { name: destination, exact: true }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.locator(".wr-page-helper")).toHaveText("00:00–24:00");
  }
  await page.reload();
  await expect(page.locator(".wr-page-helper")).toHaveText("00:00–24:00");
  await page.getByRole("button", { name: "Hours shown" }).click();
  await page.getByRole("menuitemradio", { name: /Working/ }).click();
  await expect(page.locator(".wr-page-helper")).toHaveText("08:00–18:00");
  for (const destination of ["Settings", "Activities"]) {
    await page.getByRole("button", { name: destination, exact: true }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.locator(".wr-page-helper")).toHaveText("08:00–18:00");
  }
  await page.reload();
  await expect(page.locator(".wr-page-helper")).toHaveText("08:00–18:00");
  await expect(page.getByRole("button", { name: "Next day" })).toHaveCount(0);
});

test("a quiet rail offers guidance only until another widget has something to show", async ({
  page,
  signIn,
}) => {
  const user = await signIn([
    { name: "Work", events: [meetingAt("Planning meeting", 12)] },
  ]);
  await page.addInitScript(
    (userId) =>
      localStorage.setItem(
        `wr.user.${encodeURIComponent(userId)}.wr.setup.done`,
        "1",
      ),
    user.userId,
  );
  await page.goto("/");
  await dayShown(page);
  const fallback = page.getByRole("heading", { name: "Make a little room" });
  await expect(fallback).toBeVisible();
  await page
    .locator(".wr-daygrid")
    .getByText("Planning meeting", { exact: true })
    .click();
  await expect(fallback).toBeHidden();
  await page
    .locator(".wr-today-rail")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(fallback).toBeVisible();
  // An empty addon host stays mounted for measurement; it must not suppress
  // the fallback. Any new visible widget takes precedence without a registry.
  await page.locator(".wr-today-rail").evaluate((rail) => {
    const widget = document.createElement("div");
    widget.id = "test-widget";
    widget.setAttribute("data-rail-hidden", "");
    widget.style.visibility = "hidden";
    widget.textContent = "Another widget";
    rail.append(widget);
  });
  await expect(fallback).toBeVisible();
  await page.locator("#test-widget").evaluate((widget) => {
    widget.removeAttribute("data-rail-hidden");
    widget.style.visibility = "visible";
  });
  await expect(fallback).toBeHidden();
  await page.locator("#test-widget").evaluate((widget) => widget.remove());
  await expect(fallback).toBeVisible();
  await page.setViewportSize({ width: 800, height: 650 });
  await page.screenshot({ path: "/tmp/wr-quiet-rail.png" });
  await page.getByRole("button", { name: "Review activities" }).click();
  await expect(page).toHaveURL(/\/activities$/);
});

test("an account can preview capture without exposing addons, files or other milestones, then return to core", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  await setFeatures(user, { inbox: true, quick_capture: true });
  await page.goto("/inbox");
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Quick add" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Attach files" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Addons", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await setFeatures(user, {});
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await dayShown(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Quick add" })).toHaveCount(0);
});
