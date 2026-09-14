import { API_URL } from "./environment";
import { dayShown, expect, test, todayAt } from "./support";

const M = 60_000;
async function create(token: string, input: Record<string, unknown>) {
  const response = await fetch(`${API_URL}/activities`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
}

test("Deep work has a duration-aware frequency limit that adjusts and saves", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/activities");
  await page.locator(".wr-library-pick", { hasText: "Deep work" }).click();
  const form = page.getByRole("dialog");
  const more = form.getByRole("button", { name: "How often: more" });
  while (await more.isEnabled()) await more.click();
  await expect(form.getByText("25 min", { exact: true })).toBeVisible();
  await expect(form.getByText("4 × day", { exact: true })).toBeVisible();
  await expect(more).toBeDisabled();
  await form.getByRole("button", { name: "How long: more" }).click();
  await form.getByRole("button", { name: "How long: more" }).click();
  await expect(form.getByText("35 min", { exact: true })).toBeVisible();
  await expect(form.getByText("3 × day", { exact: true })).toBeVisible();
  await expect(more).toBeDisabled();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toBeHidden();
  await page.reload();
  await expect(
    page.locator(".wr-activity-row", { hasText: "Deep work" }),
  ).toContainText("35 min · 3 × day");
});

test("three stretches spread across Today, remain movable, and dragging toward the past clamps ahead of now", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  await create(user.token, {
    name: "Stretch",
    sessionMinutes: 10,
    minimumValue: 3,
  });
  await page.goto("/");
  await dayShown(page);
  const slots = page.locator(".wr-daygrid-item", { hasText: "Stretch" });
  await expect(slots).toHaveCount(3);
  const response = await fetch(`${API_URL}/today`, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  const today = (await response.json()) as {
    slots: { id: string; startsAt: number; endsAt: number }[];
  };
  const times = today.slots.sort((a, b) => a.startsAt - b.startsAt);
  expect(times[1]!.startsAt).toBeGreaterThanOrEqual(todayAt(12));
  expect(times[2]!.startsAt).toBeGreaterThanOrEqual(todayAt(15));
  expect(times[1]!.startsAt - times[0]!.endsAt).toBeGreaterThanOrEqual(120 * M);
  const first = slots.first();
  await expect(first).toHaveClass(/wr-daygrid-item-movable/);
  await first.focus();
  // Two steps guarantee the slot is beyond the next future grid point,
  // even when the first step only snaps a just-created due slot upward.
  for (let i = 0; i < 2; i++) {
    const keyboardMove = page.waitForResponse(
      (r) => r.url().endsWith("/move") && r.request().method() === "POST",
    );
    await page.keyboard.press("ArrowDown");
    expect((await keyboardMove).status()).toBe(204);
  }
  await page.locator(".wr-page-scroll").evaluate((el) => el.scrollTo(0, 0));
  const box = await first.boundingBox();
  const grid = await page.locator(".wr-daygrid").boundingBox();
  if (!box || !grid) throw new Error("Missing timeline");
  const before = Date.now();
  const pointerMove = page.waitForResponse(
    (r) => r.url().endsWith("/move") && r.request().method() === "POST",
  );
  await page.mouse.move(box.x + 30, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, grid.y + 20, { steps: 6 });
  await page.mouse.up();
  const moved = await pointerMove;
  expect(moved.request().postDataJSON().startsAt).toBeGreaterThanOrEqual(
    before,
  );
  expect(moved.status()).toBe(204);
  const label = await first.getAttribute("aria-label");
  await page.reload();
  await dayShown(page);
  await expect(slots.first()).toHaveAttribute("aria-label", label!);
});

test("dragging an early-stopped slot moves the same occurrence without a copy", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  await create(user.token, {
    name: "Stretch",
    sessionMinutes: 10,
    minimumValue: 1,
  });
  const headers = {
    authorization: `Bearer ${user.token}`,
    "content-type": "application/json",
  };
  const before = (await (
    await fetch(`${API_URL}/today`, { headers })
  ).json()) as { slots: { id: string; startsAt: number }[] };
  const original = before.slots[0]!;
  for (const action of ["start", "skip"])
    expect(
      (
        await fetch(`${API_URL}/slots/${original.id}/${action}`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(204);
  await page.goto("/");
  await dayShown(page);
  const slots = page.locator(".wr-daygrid-item", { hasText: "Stretch" });
  await expect(slots).toHaveCount(1);
  await expect(slots.first()).toHaveClass(/wr-daygrid-item-movable/);
  await slots.first().focus();
  const moved = page.waitForResponse(
    (r) => r.url().endsWith("/move") && r.request().method() === "POST",
  );
  await page.keyboard.press("ArrowDown");
  const response = await moved;
  expect(response.status()).toBe(204);
  const destination = response.request().postDataJSON() as {
    startsAt: number;
    endsAt: number;
  };
  expect(destination.startsAt).toBeGreaterThan(original.startsAt);
  expect(destination.startsAt % (5 * 60_000)).toBe(0);
  await expect(slots).toHaveCount(1);
  const after = (await (
    await fetch(`${API_URL}/today`, { headers })
  ).json()) as { slots: { id: string; startsAt: number; status: string }[] };
  expect(after.slots.find((slot) => slot.id === original.id)).toMatchObject({
    ...destination,
    status: "planned",
  });
  expect(after.slots).toHaveLength(1);
});

test("Not placed combines shortfalls, retries without duplicates, and supports manual then automatic placement", async ({
  page,
  signIn,
}) => {
  const user = await signIn([
    {
      name: "Work",
      isPrimary: true,
      events: [
        { title: "Workshop", startsAt: todayAt(8), endsAt: todayAt(18) },
      ],
    },
  ]);
  await create(user.token, {
    name: "Stretch",
    sessionMinutes: 10,
    minimumValue: 3,
  });
  await page.goto("/");
  await dayShown(page);
  await expect(
    page.locator(".wr-daygrid-item", { hasText: "Stretch" }),
  ).toHaveCount(0);
  const widget = page.locator(".wr-widget", { hasText: "Not placed" });
  const count = widget.locator(".wr-widget-head .wr-chip");
  await expect(widget).toHaveCount(1);
  await expect(count).toHaveText("3");
  await expect(widget.getByText("10 min · 3 slots")).toBeVisible();
  await expect(page.getByText("To place", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Unscheduled slots", { exact: true }),
  ).toHaveCount(0);
  await expect(
    widget.getByRole("button", { name: /Drop|Choose time/ }),
  ).toHaveCount(0);
  const headers = {
    authorization: `Bearer ${user.token}`,
    "content-type": "application/json",
  };
  const savedIds = async () =>
    (
      (await (await fetch(`${API_URL}/bucket`, { headers })).json()) as {
        id: string;
      }[]
    )
      .map((slot) => slot.id)
      .sort();
  const ids = await savedIds();
  const blocked = page.waitForResponse(
    (r) => r.url().endsWith("/plan") && r.request().method() === "POST",
  );
  await widget.getByRole("button", { name: "Place them for me" }).click();
  expect((await blocked).status()).toBe(200);
  await expect(
    page.getByText(
      "No space on this day. Your slots are still in Not placed.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(count).toHaveText("3");
  expect(await savedIds()).toEqual(ids);
  await page.reload();
  await dayShown(page);
  await expect(count).toHaveText("3");

  // Free the calendar without asking the app to place anything yet.
  const calendars = (await (
    await fetch(`${API_URL}/calendars`, { headers })
  ).json()) as { calendars: { id: string }[] };
  const calendar = calendars.calendars[0];
  if (!calendar) throw new Error("Missing seeded calendar");
  expect(
    (
      await fetch(`${API_URL}/calendars/${calendar.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isSelected: false }),
      })
    ).ok,
  ).toBe(true);
  await page.reload();
  await dayShown(page);
  await expect(count).toHaveText("3");
  await page.screenshot({
    path: test.info().outputPath("not-placed.png"),
    animations: "disabled",
  });
  const grip = widget.getByRole("button", { name: /^Place Stretch\./ });
  await expect(grip).toBeEnabled();
  await grip.focus();
  await page.keyboard.press("Enter");
  await expect(widget.getByRole("status")).toContainText("Stretch at");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(widget.getByRole("status")).toHaveCount(0);
  await expect(count).toHaveText("3");
  await grip.scrollIntoViewIfNeeded();
  const source = await grip.boundingBox();
  const grid = await page.locator(".wr-daygrid").boundingBox();
  if (!source || !grid) throw new Error("Missing placement controls");
  const moved = page.waitForResponse(
    (r) => r.url().endsWith("/move") && r.request().method() === "POST",
  );
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(grid.x + 100, Math.max(150, grid.y) + 150, {
    steps: 8,
  });
  await page.mouse.up();
  expect((await moved).status()).toBe(204);
  await expect(count).toHaveText("2");
  await expect(
    page.locator(".wr-daygrid-item", { hasText: "Stretch" }),
  ).toHaveCount(1);
  const before = (await (
    await fetch(`${API_URL}/today`, { headers })
  ).json()) as { slots: { id: string; startsAt: number }[] };

  const filled = page.waitForResponse(
    (r) => r.url().endsWith("/plan") && r.request().method() === "POST",
  );
  await widget.getByRole("button", { name: "Place them for me" }).click();
  expect(await (await filled).json()).toMatchObject({ placed: 2, removed: 0 });
  await expect(widget).toHaveCount(0);
  await expect(
    page.locator(".wr-daygrid-item", { hasText: "Stretch" }),
  ).toHaveCount(3);
  const after = (await (
    await fetch(`${API_URL}/today`, { headers })
  ).json()) as { slots: { id: string; startsAt: number }[] };
  expect(after.slots.map((slot) => slot.id).sort()).toEqual(ids);
  expect(
    after.slots.find((slot) => slot.id === before.slots[0]?.id)?.startsAt,
  ).toBe(before.slots[0]?.startsAt);
  await page.reload();
  await dayShown(page);
  await expect(widget).toHaveCount(0);
  expect(await savedIds()).toEqual([]);
});
