import { readFile } from "node:fs/promises";
import { API_URL } from "./environment";
import { expect, test } from "./support";

test.use({ features: "all" });

const nextDay = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
test("Quick Add stays usable in a narrow window and keeps keyboard focus inside", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.setViewportSize({ width: 800, height: 650 });
  await page.goto("/inbox");
  const launcher = page.getByRole("button", { name: /Add something/ });
  await launcher.click();
  const quick = page.getByRole("dialog", { name: "Quick add" });
  const input = quick.getByRole("textbox", { name: "What to add" });
  await expect(input).toBeFocused();
  await quick.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", "# source\nhttps://example.com/reading");
    node.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
  });
  await expect(input).toHaveValue("https://example.com/reading");
  await page.keyboard.press("Shift+Tab");
  await expect(
    quick.getByRole("button", { name: "Discard draft" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  const box = await quick.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(650);
  await page.screenshot({ path: "/tmp/wr-capture-narrow.png" });
  await page.keyboard.press("Escape");
  await expect(quick).toBeHidden();
  await expect(launcher).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(input).toHaveValue("https://example.com/reading");
  await page.keyboard.press("Control+Enter");
  await expect(quick).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: /https:\/\/example.com\/reading No time yet/,
    }),
  ).toBeVisible();
});

const file = {
  name: "paper.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nSynthetic reading fixture"),
};

test("capture links and multiple files, download exact bytes, plan and return to the inbox", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/inbox");
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const quick = page.getByRole("dialog", { name: "Quick add" });
  await quick
    .getByRole("textbox", { name: "What to add" })
    .fill("https://example.com/read-later");
  await quick.getByRole("button", { name: "Add notes" }).click();
  await quick
    .getByLabel("Notes (optional)")
    .fill("Read both documents before the appointment.");
  await quick.getByLabel("Attach files").setInputFiles([
    file,
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Companion notes"),
    },
  ]);
  await page.screenshot({ path: "/tmp/wr-quick-capture.png" });
  await quick.getByRole("button", { name: /^Save to inbox/ }).click();
  await expect(quick).toBeHidden();
  await page
    .getByRole("button", {
      name: /https:\/\/example.com\/read-later No time yet/,
    })
    .click();
  let detail = page.getByRole("dialog", {
    name: "https://example.com/read-later",
    exact: true,
  });
  await expect(detail.getByText("paper.pdf", { exact: false })).toBeVisible();
  await expect(detail.getByText("notes.txt", { exact: false })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await detail
    .getByRole("button", { name: "Download", exact: true })
    .first()
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("paper.pdf");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path ?? "")).toEqual(file.buffer);
  await detail.getByRole("button", { name: "Plan a time" }).click();
  const plan = page.getByRole("dialog", { name: "Plan todo", exact: true });
  await plan.getByLabel("Day", { exact: true }).fill(nextDay());
  await plan.getByLabel("Time", { exact: true }).fill("11:05");
  await plan.getByRole("button", { name: "Plan todo", exact: true }).click();
  await expect(plan).toBeHidden();
  await detail.getByRole("button", { name: "Postpone / change time" }).click();
  const move = page.getByRole("dialog", { name: /Postpone/ });
  await move.getByRole("button", { name: "Back to inbox" }).click();
  await expect(move).toBeHidden();
  detail = page.getByRole("dialog", {
    name: "https://example.com/read-later",
    exact: true,
  });
  await expect(detail.getByText(/In your inbox · no time yet/)).toBeVisible();
  await expect(detail.getByText("paper.pdf", { exact: false })).toBeVisible();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: /https:\/\/example.com\/read-later No time yet/,
    }),
  ).toBeVisible();
});

test("file drafts survive closing, reload and a failed offline capture", async ({
  page,
  context,
  signIn,
}) => {
  await signIn();
  await page.goto("/inbox");
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  let quick = page.getByRole("dialog", { name: "Quick add" });
  await quick
    .getByRole("textbox", { name: "What to add" })
    .fill("Read the draft");
  await quick.getByLabel("Attach files").setInputFiles(file);
  await quick.getByRole("button", { name: "Close", exact: true }).click();
  await expect(quick).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  quick = page.getByRole("dialog", { name: "Quick add" });
  await expect(quick.getByRole("textbox", { name: "What to add" })).toHaveValue(
    "Read the draft",
  );
  await expect(quick.getByText(/paper.pdf/)).toBeVisible();
  await context.setOffline(true);
  await quick.getByRole("button", { name: /^Save to inbox/ }).click();
  await expect(quick.getByRole("alert")).toBeVisible();
  await expect(quick).toBeVisible();
  await context.setOffline(false);
  await quick.getByRole("button", { name: /^Save to inbox/ }).click();
  await expect(quick).toBeHidden();
  await expect(
    page.getByRole("button", { name: /Read the draft No time yet/ }),
  ).toBeVisible();
});

test("Quick Add plans a calendar slot and its card can postpone it without losing the todo", async ({
  page,
  signIn,
}) => {
  const user = await signIn();
  await page.goto("/inbox");
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const quick = page.getByRole("dialog", { name: "Quick add" });
  await quick
    .getByRole("textbox", { name: "What to add" })
    .fill("Finish the review");
  await page.keyboard.press("Enter");
  await quick.getByRole("button", { name: "Choose date and time" }).click();
  await quick.getByLabel("Day", { exact: true }).fill(nextDay());
  await quick.getByLabel("Time", { exact: true }).fill("13:00");
  await quick.getByRole("button", { name: "Place", exact: true }).click();
  await expect(quick).toBeHidden();
  const headers = { authorization: `Bearer ${user.token}` };
  const items = await (
    await page.request.get(`${API_URL}/inbox`, { headers })
  ).json();
  const todo = items.items.find(
    (item: { title: string }) => item.title === "Finish the review",
  );
  expect(todo.status).toBe("slotted");
  await page.goto(`/?date=${nextDay()}`);
  await page
    .locator(".wr-daygrid")
    .getByText("Finish the review", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Postpone / change time" })
    .first()
    .click();
  const move = page.getByRole("dialog", { name: /Postpone/ });
  await move.getByRole("button", { name: "30 minutes later" }).click();
  await expect(move).toBeHidden();
  const detail = await (
    await page.request.get(`${API_URL}/todos/${todo.id}/details`, { headers })
  ).json();
  expect(detail.slot.startsAt).toBe(todo.startsAt + 1800000);
  expect(detail.id).toBe(todo.id);
});
