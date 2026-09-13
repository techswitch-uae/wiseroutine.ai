import type { Page } from "@playwright/test";
import { API_URL } from "./environment";
import { dayShown, expect, type SeededUser, test } from "./support";

async function prepare(page: Page, user: SeededUser, minutes: number) {
  const headers = { authorization: `Bearer ${user.token}` };
  const created = await page.request.post(`${API_URL}/activities`, {
    headers,
    data: {
      name: "Read a little",
      kind: "focus",
      sessionMinutes: minutes,
      minimumType: "countPerDay",
      minimumValue: 1,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await page.goto("/");
  await dayShown(page);
  await page
    .locator(".wr-daygrid")
    .getByText("Read a little", { exact: true })
    .first()
    .click();
  const card = page.locator(".wr-widget", {
    has: page.getByText("This block", { exact: true }),
  });
  await expect(card.getByRole("button", { name: /Postpone/ })).toBeVisible();
  return { card, headers };
}

test("a core slot must be stopped early before it can be postponed, keeping its history", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  const { card, headers } = await prepare(page, user, 10);
  await card.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: /Postpone/ })).toHaveCount(0);
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
  await dialog.getByRole("button", { name: "30 minutes later" }).click();
  await expect(dialog).toBeHidden();
  const after = await (
    await page.request.get(`${API_URL}/today?range=full`, { headers })
  ).json();
  expect(
    after.slots.find((s: { id: string }) => s.id === original.id).status,
  ).toBe("skipped");
  expect(
    after.slots.some(
      (s: { id: string; status: string; title: string }) =>
        s.id !== original.id &&
        s.status === "planned" &&
        s.title === "Read a little",
    ),
  ).toBe(true);
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
  await expect(card.getByText(/stop window has closed/)).toBeVisible();
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
