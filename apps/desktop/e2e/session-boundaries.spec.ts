import type { Page } from "@playwright/test";
import { API_URL, TIME_ZONE } from "./environment";
import {
  dayShown,
  expect,
  type SeededUser,
  seed,
  seedRoutine,
  test,
} from "./support";

const user = (secondUser = false) =>
  seed<SeededUser>("/seed", { timeZone: TIME_ZONE, secondUser });
async function enter(page: Page, token: string, path = "/activities") {
  await page.goto("/signin");
  await page.evaluate((value) => {
    localStorage.setItem("wiseroutine.session", value);
    localStorage.removeItem("wiseroutine.identity");
  }, token);
  await page.goto(path);
}
const queueKey = (id: string) => `wr.user.${id}.wiseroutine.pending`;

test("another tab signing out and changing account discards old screens and late responses", async ({
  page,
  context,
}) => {
  const a = await user(),
    b = await user(true);
  await seedRoutine(
    a.token,
    { name: "Private Alpha", sessionMinutes: 10 },
    { place: false },
  );
  await seedRoutine(
    b.token,
    { name: "Private Beta", sessionMinutes: 10 },
    { place: false },
  );
  await enter(page, a.token);
  await expect(
    page.locator(".wr-activity-row", { hasText: "Private Alpha" }),
  ).toBeVisible();
  const peer = await context.newPage();
  await peer.goto("/activities");
  await expect(
    peer.locator(".wr-activity-row", { hasText: "Private Alpha" }),
  ).toBeVisible();
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(
    `${API_URL}/activities`,
    async (route) => {
      const response = await route.fetch();
      arrived();
      await held;
      await route.fulfill({ response }).catch(() => {});
    },
    { times: 1 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await started;
  await peer.locator(".wr-usermenu-trigger").click();
  await peer.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByText("Private Alpha", { exact: true })).toHaveCount(0);
  await enter(peer, b.token);
  await expect(
    peer.locator(".wr-activity-row", { hasText: "Private Beta" }),
  ).toBeVisible();
  release();
  await page.goto("/activities");
  await expect(
    page.locator(".wr-activity-row", { hasText: "Private Beta" }),
  ).toBeVisible();
  await expect(page.getByText("Private Alpha", { exact: true })).toHaveCount(0);
  const bCache = await page.evaluate(
    (id) =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith(`wr.user.${id}.`))
        .map(([, value]) => value)
        .join("\n"),
    b.userId,
  );
  expect(bCache).not.toContain("Private Alpha");
  // Separate fixture databases, not two directory rows sharing one dataset.
  const data = await page.request.get(`${API_URL}/activities`, {
    headers: { authorization: `Bearer ${a.token}` },
  });
  // Sign-out revoked A; B cannot use A's session even though its UI used to be open here.
  expect(data.status()).toBe(401);
});

test("an offline Start belongs only to its account and replays once after that account returns", async ({
  page,
  context,
}) => {
  const a = await user(),
    b = await user(true);
  await seedRoutine(
    a.token,
    { name: "Alpha slot", sessionMinutes: 20 },
    { slotStartsAt: Date.now() - 10_000 },
  );
  await enter(page, a.token, "/");
  await dayShown(page);
  await page.locator(".wr-daygrid-item", { hasText: "Alpha slot" }).click();
  const start = page
    .getByRole("complementary")
    .getByRole("button", { name: "Start", exact: true });
  await expect(start).toBeVisible();
  const peer = await context.newPage();
  await peer.goto("/settings");
  await expect(peer.locator(".wr-usermenu-trigger")).toBeVisible();
  await context.setOffline(true);
  await start.click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "[]").length,
        queueKey(a.userId),
      ),
    )
    .toBe(1);
  // No synthetic storage event: the second page changes the shared credentials.
  await peer.evaluate((token) => {
    localStorage.setItem("wiseroutine.session", token);
    localStorage.removeItem("wiseroutine.identity");
  }, b.token);
  await expect(page.getByText("Alpha slot", { exact: true })).toHaveCount(0);
  await context.setOffline(false);
  await peer.goto("/");
  await dayShown(peer);
  expect(
    await peer.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "[]").length,
      queueKey(a.userId),
    ),
  ).toBe(1);
  const bDay = await peer.request.get(`${API_URL}/today`, {
    headers: { authorization: `Bearer ${b.token}` },
  });
  expect((await bDay.json()).slots).toHaveLength(0);
  await enter(peer, a.token, "/");
  await dayShown(peer);
  await peer.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() =>
      peer.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "[]").length,
        queueKey(a.userId),
      ),
    )
    .toBe(0);
  const aDay = await peer.request.get(`${API_URL}/today`, {
    headers: { authorization: `Bearer ${a.token}` },
  });
  const slots = (await aDay.json()).slots;
  expect(slots).toHaveLength(1);
  expect(slots[0].status).toBe("started");
  await peer.reload();
  await dayShown(peer);
  const again = await peer.request.get(`${API_URL}/today`, {
    headers: { authorization: `Bearer ${a.token}` },
  });
  expect((await again.json()).slots).toMatchObject([
    {
      id: slots[0].id,
      status: "started",
      startsAt: slots[0].startsAt,
      endsAt: slots[0].endsAt,
    },
  ]);
  const history = await seed<{ events: { type: string }[] }>(
    "/inspect",
    {},
    a.token,
  );
  expect(
    history.events.filter((event) => event.type === "started"),
  ).toHaveLength(1);
});

test("a failed setting from the previous account cannot roll back the new account or show its error", async ({
  page,
  context,
}) => {
  const a = await user(),
    b = await user(true);
  const configured = await page.request.patch(`${API_URL}/settings`, {
    headers: { authorization: `Bearer ${b.token}` },
    data: { timeZone: "Asia/Kathmandu" },
  });
  expect(configured.status()).toBe(204);
  await enter(page, a.token, "/settings");
  const zone = page.getByRole("combobox", { name: "Time zone", exact: true });
  await expect(zone).toHaveValue(TIME_ZONE);
  let release!: () => void, arrived!: () => void, delivered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(
    `${API_URL}/settings`,
    async (route) => {
      arrived();
      await held;
      await route
        .fulfill({ status: 503, body: "Old account failure" })
        .catch(() => {});
      delivered();
    },
    { times: 1 },
  );
  await zone.selectOption("Europe/London");
  await started;
  const peer = await context.newPage();
  await enter(peer, b.token, "/settings");
  await expect(zone).toHaveValue("Asia/Kathmandu");
  release();
  await finished;
  await expect(zone).toHaveValue("Asia/Kathmandu");
  await expect(
    page.getByText("Couldn't change your time zone. Try again.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("two tabs placing the same remaining routine create no duplicate slots", async ({
  page,
  context,
  signIn,
}) => {
  const account = await signIn();
  await seedRoutine(
    account.token,
    { name: "Repeated stretch", sessionMinutes: 10, minimumValue: 3 },
    { place: false },
  );
  await page.goto("/");
  await dayShown(page);
  const peer = await context.newPage();
  await peer.goto("/");
  await dayShown(peer);
  await Promise.all(
    [page, peer].map(async (tab) => {
      const place = tab.getByRole("button", {
        name: "Place them for me",
        exact: true,
      });
      await expect(place).toBeEnabled();
    }),
  );
  await Promise.all(
    [page, peer].map((tab) =>
      tab
        .getByRole("button", { name: "Place them for me", exact: true })
        .click(),
    ),
  );
  await expect
    .poll(async () => {
      const response = await page.request.get(`${API_URL}/today`, {
        headers: { authorization: `Bearer ${account.token}` },
      });
      return (await response.json()).slots.length;
    })
    .toBe(3);
  for (const tab of [page, peer]) {
    await tab.reload();
    await dayShown(tab);
    await expect(
      tab.locator(".wr-daygrid-item", { hasText: "Repeated stretch" }),
    ).toHaveCount(3);
  }
});
