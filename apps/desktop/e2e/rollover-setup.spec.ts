import { API_URL } from "./environment";
import { dayShown, expect, seed, seedRoutine, test, todayAt } from "./support";

for (const scenario of ["Today", "Settings", "offline Today"] as const) {
  test(`${scenario}: midnight activates tomorrow's routine without creating slots or losing saved work`, async ({
    page,
    context,
    signIn,
  }) => {
    const before = todayAt(23, 59) + 50_000;
    const after = before + 20_000;
    await seed("/clock", { now: before });
    await page.clock.install({ time: before - 1_000 });
    await page.clock.pauseAt(before);
    const user = await signIn();
    await seedRoutine(
      user.token,
      { name: "Daily stretch", sessionMinutes: 10, minimumValue: 1 },
      { place: false, pastUnplaced: 2 },
    );
    // A saved legacy one-off is fixture history, not fresh daily demand.
    await seed(
      "/saved-slot",
      { title: "Saved task", startsAt: before - 86_400_000 },
      user.token,
    );
    const initial = await seed<{ slots: unknown[]; planRuns: number }>(
      "/inspect",
      {},
      user.token,
    );
    await page.goto("/activities");
    await page
      .locator(".wr-activity-row", { hasText: "Daily stretch" })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "How often: more" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Update", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/");
    await dayShown(page);
    const widget = page.locator(".wr-widget", {
      has: page.getByText("Not placed", { exact: true }),
    });
    await expect(
      widget.getByText("Daily stretch", { exact: true }),
    ).toBeVisible();
    await expect(widget.getByText("Saved task", { exact: true })).toBeVisible();
    await expect(
      widget.getByText("10 min · 2 slots", { exact: true }),
    ).toHaveCount(0);
    if (scenario === "Settings")
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    if (scenario === "offline Today") await context.setOffline(true);
    await seed("/clock", { now: after });
    await page.clock.runFor(20_000);
    if (scenario === "offline Today") {
      await expect(
        page.getByRole("button", { name: "Place them for me", exact: true }),
      ).not.toBeEnabled();
      await context.setOffline(false);
    }
    await expect
      .poll(async () =>
        page.evaluate((id) => {
          const cached = JSON.parse(
            localStorage.getItem(`wr.user.${id}.wiseroutine.today`) ?? "null",
          );
          return cached?.data.dayStart ?? 0;
        }, user.userId),
      )
      .toBe(todayAt(24));
    if (scenario === "Settings")
      await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      widget.getByText("10 min · 2 slots", { exact: true }),
    ).toBeVisible();
    await expect(widget.getByText("Saved task", { exact: true })).toBeVisible();
    await expect(page.locator(".wr-daygrid-item")).toHaveCount(0);
    const final = await seed<{ slots: unknown[]; planRuns: number }>(
      "/inspect",
      {},
      user.token,
    );
    expect(final.slots).toEqual(initial.slots);
    expect(final.planRuns).toBe(initial.planRuns);
    const current = await (
      await page.request.get(`${API_URL}/bucket`, {
        headers: { authorization: `Bearer ${user.token}` },
      })
    ).json();
    expect(current).toHaveLength(1);
    expect(current[0].title).toBe("Saved task");
  });
}

test("failed setup reads remain retryable and cannot persist completed onboarding", async ({
  page,
  signIn,
}) => {
  const user = await signIn([{ name: "Work" }]);
  await seedRoutine(
    user.token,
    { name: "My routine", sessionMinutes: 10 },
    { place: false },
  );
  await page.addInitScript(
    (id) => localStorage.setItem(`wr.user.${id}.wr.setup.hours`, "1"),
    user.userId,
  );
  let failing = true;
  await page.route(`${API_URL}/calendars`, async (route) => {
    if (failing)
      await route.fulfill({ status: 503, body: "Temporarily unavailable" });
    else await route.continue();
  });
  await page.goto("/");
  await dayShown(page);
  await expect(
    page.getByRole("button", { name: "Retry setup check" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`wr.user.${id}.wr.setup.done`),
      user.userId,
    ),
  ).toBeNull();
  failing = false;
  await page.getByRole("button", { name: "Retry setup check" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => localStorage.getItem(`wr.user.${id}.wr.setup.done`),
        user.userId,
      ),
    )
    .toBe("1");
  await page.reload();
  await dayShown(page);
  await expect(
    page.getByRole("button", { name: "Retry setup check" }),
  ).toHaveCount(0);
});
