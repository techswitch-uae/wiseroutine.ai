import { API_URL } from "./environment";
import { dayShown, expect, seedRoutine, test } from "./support";

// Read tomorrow's routine without the separately gated auto-planning preview.
test.use({ features: { day_view_options: true } });

test("yesterday's shortfalls do not accumulate, and repeated edits change only tomorrow's Not placed counts", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  await seedRoutine(
    user.token,
    { name: "Stretch", sessionMinutes: 10, minimumValue: 3 },
    { place: false, pastUnplaced: 2 },
  );
  await seedRoutine(
    user.token,
    { name: "Walk", sessionMinutes: 20, minimumValue: 4 },
    { place: false, pastUnplaced: 1 },
  );
  const widget = page.locator(".wr-widget", {
    has: page.getByText("Not placed", { exact: true }),
  });
  const assertToday = async () => {
    await page.goto("/");
    await dayShown(page);
    await expect(
      widget.getByRole("button", { name: "Place them for me" }),
    ).toBeEnabled();
    await expect(
      widget.getByText("10 min · 3 slots", { exact: true }),
    ).toBeVisible();
    await expect(
      widget.getByText("20 min · 4 slots", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".wr-daygrid-item")).toHaveCount(0);
  };
  await assertToday();
  for (const [name, direction, presses] of [
    ["Stretch", "more", 1],
    ["Walk", "less", 1],
    ["Stretch", "less", 2],
  ] as const) {
    await page.goto("/activities");
    await page
      .locator(".wr-activity-row", { hasText: name })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const form = page.getByRole("dialog");
    await expect(form.getByText(/start tomorrow/)).toBeVisible();
    for (let n = 0; n < presses; n++)
      await form
        .getByRole("button", { name: `How often: ${direction}` })
        .click();
    await form.getByRole("button", { name: "Update", exact: true }).click();
    await expect(form).toBeHidden();
    await assertToday();
  }
  const response = await page.request.get(`${API_URL}/activities`, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  const activities = await response.json();
  expect(
    activities
      .map((a: { minimum: { value: number } }) => a.minimum.value)
      .sort(),
  ).toEqual([2, 3]);
  expect(activities[0].changesFrom).toBe(activities[1].changesFrom);
  await page.goto(`/?date=${activities[0].changesFrom}`);
  await dayShown(page);
  await expect(
    widget.getByRole("button", { name: "Place them for me" }),
  ).toBeEnabled();
  await expect(
    widget.getByText("10 min · 2 slots", { exact: true }),
  ).toBeVisible();
  await expect(
    widget.getByText("20 min · 3 slots", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await dayShown(page);
  await expect(
    widget.getByText("10 min · 2 slots", { exact: true }),
  ).toBeVisible();
  await expect(
    widget.getByText("20 min · 3 slots", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("tomorrow-routine.png"),
    animations: "disabled",
  });
});
