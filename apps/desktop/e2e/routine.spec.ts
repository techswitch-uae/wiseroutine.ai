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
  const keyboardMove = page.waitForResponse(
    (r) => r.url().endsWith("/move") && r.request().method() === "POST",
  );
  await page.keyboard.press("ArrowDown");
  expect((await keyboardMove).status()).toBe(204);
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

test("dragging stopped work makes a new appointment without rewriting its history", async ({
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
    (r) => r.url().endsWith("/reschedule") && r.request().method() === "POST",
  );
  await page.keyboard.press("ArrowDown");
  expect((await moved).status()).toBe(200);
  await expect(slots).toHaveCount(2);
  const after = (await (
    await fetch(`${API_URL}/today`, { headers })
  ).json()) as { slots: { id: string; startsAt: number; status: string }[] };
  expect(after.slots.find((slot) => slot.id === original.id)).toMatchObject({
    startsAt: original.startsAt,
    status: "skipped",
  });
  expect(after.slots.find((slot) => slot.id !== original.id)).toMatchObject({
    status: "planned",
  });
});

test("a full day puts every shortfall in the bucket once, with a working manual recovery action", async ({
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
  const bucket = page.locator(".wr-widget", { hasText: "Unscheduled slots" });
  const count = bucket.locator(".wr-widget-head .wr-chip");
  await expect(count).toHaveText("3");
  await expect(bucket.getByText(/Not placed · no gap/).first()).toBeVisible();
  await expect(page.getByText("To place", { exact: true })).toHaveCount(0);
  await page.reload();
  await dayShown(page);
  await expect(count).toHaveText("3");
  await page
    .getByRole("button", { name: "Choose time", exact: true })
    .first()
    .click();
  const form = page.getByRole("dialog");
  await expect(form).toBeVisible();
  // An elapsed time is rejected before a mutation, even though the bucket is movable.
  await form.getByLabel("Time", { exact: true }).fill("08:00");
  await form.getByRole("button", { name: "Move slot" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await form.getByLabel("Day", { exact: true }).fill(date);
  await form.getByLabel("Time", { exact: true }).fill("10:00");
  const save = page.waitForResponse(
    (r) => r.url().endsWith("/reschedule") && r.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Move slot" }).click();
  expect((await save).status()).toBe(200);
  await expect(form).toBeHidden();
  await expect(count).toHaveText("2");
  await page.reload();
  await dayShown(page);
  await expect(count).toHaveText("2");
});
