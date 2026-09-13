import { API_URL } from "./environment";
import { expect, test, todayAt } from "./support";

test.use({ features: "all" });

const fullToday = (url: string) =>
  url.includes("/today?") && new URL(url).searchParams.get("range") === "full";

test("operational today loads and refreshes on Settings without visiting Day", async ({
  page,
  signIn,
}) => {
  await signIn();
  const first = page.waitForResponse(
    (response) => fullToday(response.url()) && response.status() === 200,
  );
  await page.goto("/settings");
  expect((await (await first).json()).range).toBe("full");
  await expect(
    page.getByRole("heading", { name: "Calendar privacy", exact: true }),
  ).toBeVisible();
  const refreshed = page.waitForResponse(
    (response) => fullToday(response.url()) && response.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(page).toHaveURL(/\/settings$/);
});

test("privacy opt-out erases existing titles and persists across a full page reload", async ({
  page,
  signIn,
}) => {
  const user = await signIn([
    {
      name: "Work",
      isSelected: true,
      events: [
        {
          title: "Confidential appointment",
          startsAt: todayAt(12),
          endsAt: todayAt(13),
        },
      ],
    },
  ]);
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Save meeting details" });
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(
    /Turning this off removes saved meeting details/,
  );
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/settings") &&
      response.request().method() === "PATCH",
  );
  await toggle.click();
  expect((await saved).status()).toBe(204);
  await expect(toggle).not.toBeChecked();
  await page.setViewportSize({ width: 800, height: 650 });
  await page
    .getByRole("heading", { name: "Calendar privacy", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/wr-privacy-settings.png" });
  await page.reload();
  const response = await page.request.get(`${API_URL}/today?range=full`, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.meetings).toHaveLength(1);
  expect(data.meetings[0]).toMatchObject({
    title: null,
    joinUrl: null,
    description: null,
  });
  await expect(page.getByText(/Only busy times are saved/)).toBeVisible();
  await expect(toggle).not.toBeChecked();
});
