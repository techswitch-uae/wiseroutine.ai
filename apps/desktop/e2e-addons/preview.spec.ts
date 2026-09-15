import { expect, test } from "@playwright/test";

test("the standalone host connects a real SDK widget without app data or network access", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://example.invalid/**", async (route) => {
    requests++;
    await route.abort();
  });
  await page.goto("/");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#role")).toHaveText("widget:card");
  await expect(frame.locator("#isolation")).toHaveText("true");
  await expect(frame.locator("#storage")).toHaveText("true");
  await expect(frame.locator("#network")).toHaveText("blocked");
  expect(requests).toBe(0);
  await expect(frame.locator("#stored")).toHaveText("kept");
  await expect(page.locator("#log")).toContainText("setSlotStatus: OK");
  await expect(page.locator("#log")).toContainText("todos.list: OK");
  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
});

test("denied permissions fail visibly and restarting establishes a fresh connection", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.frameLocator("iframe").locator("#role")).toHaveText(
    "widget:card",
  );
  await page.getByLabel('{"kind":"ui:widget"}', { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Restart with these permissions" })
    .click();
  await expect(page.frameLocator("iframe").locator("#error")).toContainText(
    "denied",
  );
  await page.getByLabel('{"kind":"ui:widget"}', { exact: true }).check();
  await page
    .getByRole("button", { name: "Restart with these permissions" })
    .click();
  await expect(page.frameLocator("iframe").locator("#role")).toHaveText(
    "widget:card",
  );
});

test("the selected activity-type key and Quick Add writes cross the public wire", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Contribution", { exact: true }).selectOption("2");
  await page
    .getByRole("button", { name: "Restart with these permissions" })
    .click();
  await expect(page.frameLocator("iframe").locator("#role")).toHaveText(
    "session:stretch",
  );
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Finish" })
    .click();
  await expect(page.locator("#status")).toHaveText(
    "Synthetic session completed",
  );
  await page.getByRole("button", { name: "Send Quick Add" }).click();
  await expect(page.locator("#log")).toContainText("Created synthetic todo");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});
