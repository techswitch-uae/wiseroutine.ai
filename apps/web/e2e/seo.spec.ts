import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("the server renders the promise, sample, FAQ and metadata without JavaScript", async ({
  page,
  request,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your day changes",
  );
  await expect(page.getByTestId("slot-focus")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Extend team check-in" }),
  ).toBeDisabled();
  // Playwright's text engine deliberately excludes noscript descendants.
  await expect(page.locator("noscript p")).toBeVisible();
  await expect(page.locator("noscript p")).toContainText("Turn on JavaScript");
  await page.locator("summary").first().click();
  await expect(page.locator("details").first()).toHaveAttribute("open", "");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://wiseroutine.ai/",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /finds room around your meetings/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://wiseroutine.ai/social-card.png",
  );
  for (const path of [
    "/favicon.svg",
    "/social-card.png",
    "/robots.txt",
    "/sitemap.xml",
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "https://wiseroutine.ai/",
  );
});
