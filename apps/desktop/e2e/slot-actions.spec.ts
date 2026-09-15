import type { Page } from "@playwright/test";
import { API_URL } from "./environment";
import {
  dayShown,
  expect,
  type SeededUser,
  seedRoutine,
  test,
} from "./support";

async function prepare(page: Page, user: SeededUser, minutes: number) {
  const headers = { authorization: `Bearer ${user.token}` };
  await seedRoutine(user.token, {
    name: "Read a little",
    kind: "focus",
    sessionMinutes: minutes,
    minimumType: "countPerDay",
    minimumValue: 1,
  });
  await page.goto("/");
  await dayShown(page);
  await page
    .locator(".wr-daygrid")
    .getByText("Read a little", { exact: true })
    .first()
    .click();
  const card = page.locator(".wr-widget", {
    has: page.getByText("This slot", { exact: true }),
  });
  await expect(card.getByRole("button", { name: /Postpone/ })).toBeVisible();
  return { card, headers };
}

for (const entry of ["timeline", "widget"] as const) {
  test(`${entry}: Start becomes Running before the response, then Done persists across reload`, async ({
    page,
    signIn,
  }) => {
    const user = await signIn();
    const { card } = await prepare(page, user, 10);
    const block = page.locator(".wr-daygrid-item", {
      hasText: "Read a little",
    });
    const start = entry === "timeline" ? block : card;
    await expect(
      block.getByRole("button", { name: "Start", exact: true }),
    ).toBeVisible();

    // Hold only the request, not a fabricated response. The real Worker and
    // DB still process Start after we verify the optimistic UI on both surfaces.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${API_URL}/slots/*/start`, async (route) => {
      await held;
      await route.continue();
    });
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/start") && r.request().method() === "POST",
    );
    try {
      await start.getByRole("button", { name: "Start", exact: true }).click();
      await expect(
        block.getByRole("button", { name: "Start", exact: true }),
      ).toHaveCount(0);
      await expect(
        block.getByRole("img", { name: "Running", exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole("img", { name: "Running", exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole("button", { name: "Start", exact: true }),
      ).toHaveCount(0);
      await expect(
        card.getByRole("button", { name: "Mark it done" }),
      ).toBeDisabled();
      await expect(
        card.getByRole("button", { name: "Stop", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Start now", exact: true }),
      ).toHaveCount(0);
      await expect(block).not.toHaveAttribute("aria-label", /Enter to start/);
      const refreshed = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/today",
      );
      await page.getByRole("button", { name: "Sync calendars now" }).click();
      await refreshed;
      await expect(
        block.getByRole("img", { name: "Running", exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole("button", { name: "Mark it done" }),
      ).toBeDisabled();
    } finally {
      release();
    }
    expect((await response).status()).toBe(204);
    await page.reload();
    await dayShown(page);
    await expect(
      block.getByRole("img", { name: "Running", exact: true }),
    ).toBeVisible();
    await expect(
      block.getByRole("button", { name: "Start", exact: true }),
    ).toHaveCount(0);
    await block.getByText("Read a little", { exact: true }).click();
    await card.getByRole("button", { name: "Mark it done" }).click();
    await expect(
      block.getByRole("img", { name: "Done", exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("img", { name: "Done", exact: true }),
    ).toBeVisible();
    await expect(card.locator("p")).toHaveCount(0);
    await expect(block.getByRole("button")).toHaveCount(0);
    await page.reload();
    await dayShown(page);
    await expect(
      block.getByRole("img", { name: "Done", exact: true }),
    ).toBeVisible();
    await expect(block.getByRole("button")).toHaveCount(0);
  });
}

test("a refused start restores Start instead of leaving a false Running cue", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  const { card } = await prepare(page, user, 10);
  const block = page.locator(".wr-daygrid-item", { hasText: "Read a little" });
  await page.route(`${API_URL}/slots/*/start`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "test_refusal" }),
    }),
  );
  await block.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Couldn't start that just now.")).toBeVisible();
  await expect(
    block.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  await expect(
    block.getByRole("img", { name: "Running", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("img", { name: "Running", exact: true }),
  ).toHaveCount(0);
});

test("an approaching slot gains a play action when due, not a false Running cue", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  const { headers } = await prepare(page, user, 10);
  const plan = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  const slot = plan.slots.find(
    (item: { title: string }) => item.title === "Read a little",
  );
  const before = Math.floor(slot.startsAt / 60_000) * 60_000 - 60_000;
  const due = Math.ceil(slot.startsAt / 60_000) * 60_000;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: before });
  await page.clock.pauseAt(before);
  await page.reload();
  await dayShown(page);
  const block = page.locator(".wr-daygrid-item", { hasText: "Read a little" });
  await expect(block).toBeVisible();
  await expect(
    block.getByRole("button", { name: "Start", exact: true }),
  ).toHaveCount(0);
  await expect(
    block.getByRole("img", { name: "Running", exact: true }),
  ).toHaveCount(0);
  await page.clock.fastForward(due - before);
  await expect(
    block.getByRole("button", { name: "Start", exact: true }),
  ).toBeVisible();
  await expect(
    block.getByRole("img", { name: "Running", exact: true }),
  ).toHaveCount(0);
});

test("a core slot must be stopped early before moving the same slot, without a copy", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  const { card, headers } = await prepare(page, user, 10);
  const started = page.waitForResponse(
    (r) => r.url().endsWith("/start") && r.request().method() === "POST",
  );
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: /Postpone/ })).toHaveCount(0);
  expect((await started).status()).toBe(204);
  const before = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  const original = before.slots.find(
    (slot: { status: string }) => slot.status === "started",
  );
  expect(original.startedAt).toEqual(expect.any(Number));
  const stop = page.waitForResponse((r) =>
    r.url().endsWith(`/slots/${original.id}/skip`),
  );
  await card.getByRole("button", { name: "Stop", exact: true }).click();
  expect((await stop).status()).toBe(204);
  await expect(card.getByRole("button", { name: /Postpone/ })).toBeVisible();
  await card.getByRole("button", { name: /Postpone/ }).click();
  const dialog = page.getByRole("dialog", { name: /Postpone/ });
  await dialog.getByRole("button", { name: "Move slot" }).click();
  await expect(dialog).toBeHidden();
  const after = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  expect(
    after.slots.find((s: { id: string }) => s.id === original.id).status,
  ).toBe("planned");
  expect(
    after.slots.filter((s: { title: string }) => s.title === "Read a little"),
  ).toHaveLength(1);
});

test("the stop cutoff survives a reload and the core widget updates without a refresh", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  // Keep the synthetic clock independent of Web Animations' real timeline.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { card, headers } = await prepare(page, user, 3);
  // Browser clock only: the actual stored Start is in the past, as for an
  // offline action, so this tests the real API's refusal without a 90s wait.
  const before = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  const slot = before.slots.find(
    (s: { title: string }) => s.title === "Read a little",
  );
  const startedAt = Date.now() - 100_000;
  expect(
    (
      await page.request.post(`${API_URL}/slots/${slot.id}/start`, {
        headers,
        data: { at: startedAt },
      })
    ).status(),
  ).toBe(204);
  await page.clock.install({ time: startedAt + 80_000 });
  await page.clock.pauseAt(startedAt + 89_000);
  await page.reload();
  await dayShown(page);
  await page
    .locator(".wr-daygrid")
    .getByText("Read a little", { exact: true })
    .first()
    .click();
  await expect(
    card.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: /Postpone/ })).toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect(
    card.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("img", { name: "Running", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post(`${API_URL}/slots/${slot.id}/skip`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(409);
  await page.reload();
  await dayShown(page);
  await page
    .locator(".wr-daygrid")
    .getByText("Read a little", { exact: true })
    .first()
    .click();
  await expect(
    card.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Postpone/ })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Mark it done" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 800, height: 650 });
  await expect(card).toBeVisible();
  await page.screenshot({ path: "/tmp/wr-slot-cutoff.png" });
});

test("early Start then Stop expires at the scheduled cutoff, closes Postpone, and only permits recording Done", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { card, headers } = await prepare(page, user, 10);
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await card.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const before = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  const original = before.slots.find(
    (s: { title: string }) => s.title === "Read a little",
  );
  expect(original.status).toBe("skipped");
  // The real server retains the stopped slot; only the browser clock advances.
  // API tests separately assert server refusal at and beyond this boundary.
  const edge = original.startsAt + 120_000;
  await page.clock.install({ time: edge - 2_000 });
  await page.clock.pauseAt(edge - 1_000);
  await page.reload();
  await dayShown(page);
  const block = page.locator(".wr-daygrid-item", { hasText: "Read a little" });
  await block.getByText("Read a little", { exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await expect(block).toHaveClass(/wr-daygrid-item-movable/);
  await card.getByRole("button", { name: /Postpone/ }).click();
  const dialog = page.getByRole("dialog", { name: /Postpone/ });
  await expect(
    dialog.getByText(/creates a new|original session stays/),
  ).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(dialog).toBeHidden();
  await expect(
    card.getByRole("button", { name: /^(Start|Resume|Earlier|Later)$/ }),
  ).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Postpone/ })).toHaveCount(0);
  await expect(block).not.toHaveClass(/wr-daygrid-item-movable/);
  await expect(block.getByRole("button")).toHaveCount(0);
  await page.reload();
  await dayShown(page);
  await block.getByText("Read a little", { exact: true }).click();
  await expect(
    card.getByRole("button", { name: /Resume|Postpone/ }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Mark it done" }).click();
  await expect(
    block.getByRole("img", { name: "Done", exact: true }),
  ).toBeVisible();
  const after = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  const slots = after.slots.filter(
    (s: { title: string }) => s.title === "Read a little",
  );
  expect(slots).toHaveLength(1);
  expect(slots[0]).toMatchObject({
    id: original.id,
    startsAt: original.startsAt,
    status: "completed",
  });
});
