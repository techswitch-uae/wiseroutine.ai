import { expect, test } from "../e2e/support";

test("built SPA supports direct links/reload without Vite or broken assets", async ({ page, signIn }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const missing: string[] = [];
  page.on("response", (response) => { if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/assets/")) missing.push(response.url()); });
  await signIn();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Calendar privacy", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Save meeting details/ })).toBeChecked();
  const html = await (await page.request.get("/", { headers: { accept: "text/html" } })).text();
  expect(html).not.toContain("/@vite/client");
  expect(html).not.toContain("/src/");
  expect((await page.request.get("/assets/missing.js")).status()).toBe(404);
  expect((await page.request.post("/__verdicts", { data: {} })).status()).toBe(405);
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
});

test("development-only screens are unavailable in the built app", async ({ page }) => {
  for (const path of ["/design", "/sim"]) {
    await page.goto(path);
    await expect(page.getByText("Not Found", { exact: true })).toBeVisible();
  }
});
