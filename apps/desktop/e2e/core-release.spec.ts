import { API_URL } from "./environment";
import { dayShown, expect, setFeatures, test } from "./support";

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
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Manage calendars" }),
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
