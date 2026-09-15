import { API_URL } from "./environment";
import { dayShown, expect, seedRoutine, test } from "./support";

for (const entry of ["timeline", "widget"] as const) {
  test(`${entry}: an ignored slot still starts after movement expires, without changing its appointment`, async ({
    page,
    signIn,
  }, testInfo) => {
    const user = await signIn();
    const startsAt = Date.now() - 180_000;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedRoutine(
      user.token,
      { name: "Read a little", kind: "focus", sessionMinutes: 10 },
      { slotStartsAt: startsAt },
    );
    await page.goto("/");
    await dayShown(page);
    const block = page.locator(".wr-daygrid-item", {
      hasText: "Read a little",
    });
    const card = page.locator(".wr-widget", {
      has: page.getByRole("heading", { name: "Read a little", exact: true }),
    });
    await block.getByText("Read a little", { exact: true }).click();
    await expect(block).not.toHaveClass(/wr-daygrid-item-movable/);
    await expect(
      card.getByRole("button", { name: /Postpone|Earlier|Later/ }),
    ).toHaveCount(0);
    await expect(card.getByText("Time passed", { exact: true })).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Start", exact: true }),
    ).toBeVisible();
    await expect(
      block.getByRole("button", { name: "Start", exact: true }),
    ).toBeVisible();
    await page.reload();
    await dayShown(page);
    await block.getByText("Read a little", { exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Start", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("late-start.png") });
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/start") &&
        response.request().method() === "POST",
    );
    await (entry === "timeline" ? block : card)
      .getByRole("button", { name: "Start", exact: true })
      .click();
    expect((await accepted).status()).toBe(204);
    await expect(
      block.getByRole("img", { name: "Running", exact: true }),
    ).toBeVisible();
    await page.reload();
    await dayShown(page);
    await expect(
      block.getByRole("img", { name: "Running", exact: true }),
    ).toBeVisible();
    const response = await page.request.get(`${API_URL}/today`, {
      headers: { authorization: `Bearer ${user.token}` },
    });
    const day = await response.json();
    expect(day.slots).toMatchObject([
      { status: "started", startsAt, endsAt: startsAt + 600_000 },
    ]);
    expect(day.slots).toHaveLength(1);
  });
}

test("an ignored slot loses Start at its actual end, including after wake and reload", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  const startsAt = Date.now() - 180_000;
  const endsAt = startsAt + 600_000;
  await seedRoutine(
    user.token,
    { name: "Read a little", kind: "focus", sessionMinutes: 10 },
    { slotStartsAt: startsAt },
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: endsAt - 2_000 });
  await page.clock.pauseAt(endsAt - 1_000);
  await page.goto("/");
  await dayShown(page);
  const block = page.locator(".wr-daygrid-item", { hasText: "Read a little" });
  const card = page.locator(".wr-widget", {
    has: page.getByRole("heading", { name: "Read a little", exact: true }),
  });
  await block.getByText("Read a little", { exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  // No refresh or focus event: both timeline and widget expire on the clock.
  await page.clock.fastForward(1_000);
  await expect(
    card.getByRole("button", { name: /Start|Resume|Postpone|Earlier|Later/ }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Mark it done" }),
  ).toBeVisible();
  await expect(
    block.getByRole("button", { name: "Start", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    block.getByRole("button", { name: "Start", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await dayShown(page);
  await block.getByText("Read a little", { exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Start", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Mark it done" }),
  ).toBeVisible();
});
