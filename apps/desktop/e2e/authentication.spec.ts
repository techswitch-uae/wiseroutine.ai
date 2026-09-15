import type { Page } from "@playwright/test";
import { API_URL } from "./environment";
import { dayShown, expect, seed, test } from "./support";

async function requestCode(page: Page, email: string) {
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  return (await seed<{ otp: string }>("/mail", { email })).otp;
}
const enterCode = (page: Page, code: string) =>
  page.locator('input[autocomplete="one-time-code"]').fill(code);
async function signOut(page: Page) {
  await page.locator(".wr-usermenu-trigger").click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
}

test("first signup verifies the emailed code, provisions Free, and returning sign-in keeps the same account", async ({
  page,
}) => {
  const email = "first-signup@e2e.invalid";
  await page.goto("/signin");
  const code = await requestCode(page, email);
  await enterCode(page, code === "000000" ? "111111" : "000000");
  await expect(page.getByRole("alert")).toContainText("did not match");
  expect(
    await page.evaluate(() => localStorage.getItem("wiseroutine.session")),
  ).toBeNull();
  await enterCode(page, code);
  await dayShown(page);
  const identity = await page.evaluate(() =>
    localStorage.getItem("wiseroutine.identity"),
  );
  expect(identity).toBeTruthy();
  const token = await page.evaluate(() =>
    localStorage.getItem("wiseroutine.session"),
  );
  const response = await page.request.get(`${API_URL}/auth/get-session`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect((await response.json()).user).toMatchObject({
    email,
    plan: "free",
    databaseReady: true,
    schemaVersion: 16,
  });
  await signOut(page);
  await enterCode(page, await requestCode(page, email));
  await dayShown(page);
  expect(
    await page.evaluate(() => localStorage.getItem("wiseroutine.identity")),
  ).toBe(identity);
});

test("an expired code is refused and a new code recovers without bypassing verification", async ({
  page,
}) => {
  const email = "expired@e2e.invalid";
  await page.goto("/signin");
  const old = await requestCode(page, email);
  await seed("/mail/expire", { email });
  await enterCode(page, old);
  await expect(
    page.getByRole("heading", { name: "That code has expired" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("wiseroutine.session")),
  ).toBeNull();
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await enterCode(page, (await seed<{ otp: string }>("/mail", { email })).otp);
  await dayShown(page);
});

test("repeated wrong codes are rate limited without issuing a session", async ({
  page,
}) => {
  const email = "attempt-budget@e2e.invalid";
  await page.goto("/signin");
  const original = await requestCode(page, email);
  for (const digit of ["1", "2", "3"]) {
    const wrong = digit.repeat(6) === original ? "999999" : digit.repeat(6);
    await enterCode(page, wrong);
    await expect(page.getByRole("alert")).toContainText("did not match");
  }
  await enterCode(page, original);
  await expect(page.getByRole("alert")).toContainText("Too many attempts");
  expect(
    await page.evaluate(() => localStorage.getItem("wiseroutine.session")),
  ).toBeNull();
});

test("provisioning failure issues no usable session; retry repairs the existing account", async ({
  page,
}) => {
  const email = "recover-provisioning@e2e.invalid";
  await seed("/infrastructure", { provisionFailure: true });
  await page.goto("/signin");
  await enterCode(page, await requestCode(page, email));
  await expect(page.getByRole("alert")).toContainText("wrong on our side");
  expect(
    await page.evaluate(() => localStorage.getItem("wiseroutine.session")),
  ).toBeNull();
  await seed("/infrastructure", { provisionFailure: false });
  await page.getByRole("button", { name: /Back/ }).click();
  await enterCode(page, await requestCode(page, email));
  await dayShown(page);
  await page.getByRole("button", { name: "Activities", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Something else", exact: true }),
  ).toBeVisible();
});
