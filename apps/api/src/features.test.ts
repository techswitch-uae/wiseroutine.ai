import { env, exports as worker } from "cloudflare:workers";
import {
  CORE_FEATURES,
  FEATURE_CONFIG_KEY,
  featureUserKey,
} from "@wiseroutine/plans/features";
import { beforeEach, expect, test } from "vitest";
import { readFeatures } from "./features";
import {
  directory,
  resetDatabases,
  seedActivity,
  seedUser,
  type TestUser,
  testFeatures,
  userDb,
} from "./test-support";

const config = env.CONFIG as KVNamespace;
beforeEach(async () => {
  await resetDatabases();
  await config.delete(FEATURE_CONFIG_KEY);
});
const call = (user: TestUser, path: string, method = "GET", body?: unknown) =>
  worker.default.fetch(`http://api${path}`, {
    method,
    headers: { ...user.headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test.each(["free", "pro"] as const)(
  "core allows three activities on %s, refuses a fourth, and removal frees a place",
  async (plan) => {
    const user = await seedUser({ plan });
    let first = "";
    for (let i = 0; i < 3; i++) {
      const response = await call(user, "/activities", "POST", {
        name: `Activity ${i}`,
        sessionMinutes: 10,
      });
      expect(response.status).toBe(201);
      const row = (await response.json()) as { id: string };
      if (i === 0) first = row.id;
    }
    const fourth = () =>
      call(user, "/activities", "POST", { name: "Fourth", sessionMinutes: 10 });
    expect((await fourth()).status).toBe(402);
    expect((await call(user, `/activities/${first}`, "DELETE")).status).toBe(
      200,
    );
    expect((await fourth()).status).toBe(201);
  },
);

test("missing configuration gives every account the real all-off defaults", async () => {
  const user = await seedUser({ plan: "pro" });
  const response = await call(user, "/features");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ features: CORE_FEATURES });
  expect((await worker.default.fetch("http://api/features")).status).toBe(401);
  expect(await (await call(user, "/addons")).json()).toEqual({ addons: [] });
  expect(await userDb().addon.count()).toBe(0);
});

test.each([
  ["/capture", "POST"],
  ["/inbox", "GET"],
  ["/todos", "GET"],
  ["/todos", "POST"],
  ["/todos/id", "PATCH"],
  ["/todos/id/details", "GET"],
  ["/todos/id/details", "PUT"],
  ["/scope", "GET"],
  ["/addons/available", "GET"],
  ["/addons/wiseroutine.breathing/install", "POST"],
  ["/addons/wiseroutine.breathing", "PATCH"],
  ["/addons/bundles/hash", "GET"],
  ["/captures/intent/files/id", "PUT"],
  ["/todos/id/files/id", "PUT"],
])(
  "unreleased endpoint %s %s is refused even for Pro",
  async (path, method) => {
    const user = await seedUser({ plan: "pro" });
    const response = await call(
      user,
      path,
      method,
      method === "GET" ? undefined : {},
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: "feature_unavailable",
    });
    expect(await userDb().reminder.count()).toBe(0);
  },
);

test("checkout is closed but subscription management is not hidden from an existing customer", async () => {
  const user = await seedUser({ plan: "pro" });
  expect((await call(user, "/billing/checkout", "POST", {})).status).toBe(403);
  expect(await (await call(user, "/billing")).json()).toMatchObject({
    offerEnabled: false,
    plan: "pro",
  });
  expect((await call(user, "/billing/portal", "POST", {})).status).toBe(404); // no subscription, not a release gate
});

test("per-account previews do not publish to other accounts or upgrade plans", async () => {
  const preview = await seedUser();
  const publicUser = await seedUser();
  await config.put(
    featureUserKey(preview.userId),
    JSON.stringify({ guided_sessions: true, advanced_scheduling: true }),
  );
  expect((await readFeatures(config, preview.userId)).guided_sessions).toBe(
    true,
  );
  expect((await readFeatures(config, publicUser.userId)).guided_sessions).toBe(
    false,
  );
  expect(
    (
      await call(preview, "/activities", "POST", {
        name: "Focus",
        preferredWindows: [600],
      })
    ).status,
  ).toBe(402);
  expect(
    (await directory().user.findUnique({ where: { id: preview.userId } }))
      ?.plan,
  ).toBe("free");
  await config.delete(featureUserKey(preview.userId));
});

test("malformed configuration and unavailable KV fail closed without breaking core", async () => {
  const user = await seedUser();
  await config.put(FEATURE_CONFIG_KEY, '{"guided_sessions":"true"}');
  expect(await readFeatures(config, user.userId)).toEqual(CORE_FEATURES);
  expect(
    await readFeatures(
      {
        get: async () => {
          throw new Error("offline");
        },
      } as unknown as KVNamespace,
      user.userId,
    ),
  ).toEqual(CORE_FEATURES);
  expect((await call(user, "/activities")).status).toBe(200);
});

test("guided-session rollback unloads visibility without uninstalling or rewriting activities", async () => {
  const user = await seedUser();
  await testFeatures({ guided_sessions: true });
  const enabled = (await (await call(user, "/addons")).json()) as {
    addons: { id: string }[];
  };
  expect(enabled.addons).toHaveLength(4);
  expect(
    enabled.addons.every(
      (addon) =>
        !["wiseroutine.todos", "wiseroutine.day-so-far"].includes(addon.id),
    ),
  ).toBe(true);
  await testFeatures();
  expect(await (await call(user, "/addons")).json()).toEqual({ addons: [] });
  expect(await userDb().addon.count()).toBe(4);
  const response = await worker.default.fetch("http://api/todos", {
    headers: { ...user.headers, "x-wr-addon": "wiseroutine.todos" },
  });
  expect(response.status).toBe(404);
});

test("advanced fields and bucket-to-inbox are gated, while basic activity edits work", async () => {
  const user = await seedUser({ plan: "pro" });
  expect(
    (
      await call(user, "/activities", "POST", {
        name: "Focus",
        preferredWindows: [600],
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call(user, "/activities", "POST", {
        name: "Focus",
        minimumType: "countPerWeek",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call(user, "/activities", "POST", {
        name: "Breathe",
        presetKey: "wiseroutine.breathing/pacer",
      })
    ).status,
  ).toBe(404);
  expect(
    (await call(user, "/slots/id/reschedule", "POST", { bucket: true })).status,
  ).toBe(404);
  expect(
    (await call(user, "/settings", "PATCH", { customRangeLabel: "Evening" }))
      .status,
  ).toBe(404);
  expect(
    (
      await call(user, "/settings", "PATCH", {
        dayStartMinutes: 480,
        dayEndMinutes: 1080,
      })
    ).status,
  ).toBe(204);
});

function workingZone() {
  return (
    [
      "UTC",
      "America/New_York",
      "Pacific/Honolulu",
      "Asia/Tokyo",
      "Asia/Dubai",
      "Australia/Perth",
    ].find((timeZone) => {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "numeric",
          hourCycle: "h23",
        }).format(Date.now()),
      );
      return hour >= 8 && hour < 15;
    }) ?? "UTC"
  );
}

test("Free explicitly places an established routine; new activities wait until tomorrow; pause and move stay core", async () => {
  const user = await seedUser({ timeZone: workingZone() });
  const start = Date.now();
  const id = await seedActivity({
    name: "Focus",
    minimumValue: 1,
    sessionMinutes: 10,
  });
  expect((await call(user, "/plan", "POST", {})).status).toBe(200);
  const original = await userDb().slot.findFirst({ where: { activityId: id } });
  expect(original).not.toBeNull();
  expect(original?.startsAt.getTime()).toBeGreaterThanOrEqual(start);
  expect(
    (
      await call(user, "/activities", "POST", {
        name: "Walk",
        minimumValue: 1,
        sessionMinutes: 10,
      })
    ).status,
  ).toBe(201);
  expect(
    await userDb().slot.findUnique({ where: { id: original?.id ?? "" } }),
  ).toMatchObject({ startsAt: original?.startsAt });
  const today = (await (await call(user, "/today")).json()) as {
    slots: { id: string; presetKey: string | null }[];
    widgets: string[];
  };
  expect(today.slots).toHaveLength(1);
  expect(today.slots.every((slot) => slot.presetKey === null)).toBe(true);
  expect(today.widgets).not.toContain("today_so_far");
  const slots = await userDb().slot.findMany({ orderBy: { startsAt: "asc" } });
  const last = slots.at(-1);
  expect(last).toBeDefined();
  const at = (last?.endsAt.getTime() ?? Date.now()) + 600_000;
  expect(
    (
      await call(user, `/slots/${last?.id}/reschedule`, "POST", {
        startsAt: at,
        endsAt: at + 600_000,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(user, `/activities/${last?.activityId}`, "PATCH", {
        isActive: false,
      })
    ).status,
  ).toBe(204);
  expect(
    (await userDb().slot.findUnique({ where: { id: last?.id ?? "" } }))?.status,
  ).toBe("cancelled");
  expect(
    (await call(user, "/plan", "POST", { trigger: "calendar_change" })).status,
  ).toBe(200);
});

test("turning off files blocks new uploads and claims but preserves authenticated downloads and deletion", async () => {
  const user = await seedUser();
  await testFeatures({ inbox: true, quick_capture: true, capture_files: true });
  const intent = crypto.randomUUID(),
    file = crypto.randomUUID();
  const upload = await worker.default.fetch(
    `http://api/captures/${intent}/files/${file}`,
    {
      method: "PUT",
      headers: { ...user.headers, "x-file-name": "example.txt" },
      body: "kept",
    },
  );
  expect(upload.status).toBe(201);
  const capture = await call(user, "/capture", "POST", {
    id: intent,
    title: "Read",
    notes: "",
    links: [],
    fileIds: [file],
    minutes: 10,
  });
  const { todoId } = (await capture.json()) as { todoId: string };
  await testFeatures({ inbox: true, quick_capture: true });
  expect(
    (
      await call(user, "/capture", "POST", {
        id: crypto.randomUUID(),
        title: "Read",
        fileIds: [file],
        minutes: 10,
      })
    ).status,
  ).toBe(404);
  const download = await call(user, `/todos/${todoId}/files/${file}`);
  expect(download.status).toBe(200);
  expect(await download.text()).toBe("kept");
  await testFeatures();
  expect(
    (await call(user, `/todos/${todoId}/files/${file}`, "DELETE")).status,
  ).toBe(204);
});
