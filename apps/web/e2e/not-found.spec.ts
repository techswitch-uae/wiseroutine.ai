import { expect, test } from "@playwright/test";

test("unknown routes return a real 404 with a usable route home", async ({
  page,
}) => {
  // A 404 resource console message is expected; JavaScript errors are not.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/not-a-page");
  expect(response?.status()).toBe(404);
  await page.getByRole("link", { name: "Back to Wise Routine" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your day changes",
  );
  expect(errors).toEqual([]);
});
