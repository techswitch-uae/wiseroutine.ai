import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, flushPending, setSessionToken } from "./api";
import {
  cachedPlan,
  cachePlan,
  enqueue,
  hasLegacyPending,
  pending,
} from "./offline";
import {
  publishPlan,
  publishReload,
  reloadPlan,
  todaySnapshot,
} from "./plan-store";
import { identifySession, sessionSignal } from "./session-lifecycle";
import { startTodayController, startTodaySlot } from "./today-controller";
import { reloadTodos, todosSnapshot } from "./todos";

const now = Date.UTC(2026, 5, 15, 12);
type Plan = Awaited<ReturnType<typeof api.today>>;
const plan = (): Plan => ({
  stale: false,
  cachedAt: now,
  date: { year: 2026, month: 6, day: 15 },
  timeZone: "UTC",
  dayStart: now - 12 * 3600000,
  dayEnd: now + 12 * 3600000,
  range: "full",
  ranges: [],
  widgets: [],
  syncedAt: now,
  outside: { before: [], after: [] },
  meetings: [
    {
      id: "e",
      title: "Private",
      startsAt: now,
      endsAt: now + 600000,
      isAllDay: false,
      joinUrl: "https://secret.example",
      description: "Secret",
    },
  ],
  slots: [
    {
      id: "s",
      title: "Focus",
      kind: "focus",
      startsAt: now,
      endsAt: now + 600000,
      status: "planned",
      isLocked: false,
      conflictEventId: null,
    },
  ],
});
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const ok = () => new Response(null, { status: 204 });
const fetcher = () => vi.mocked(fetch);
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  setSessionToken(null);
  localStorage.clear();
  setSessionToken("token-a");
  identifySession("user-a");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  stop?.();
  stop = undefined;
  setSessionToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each([401, 408, 429, 500, 503])(
  "HTTP %s retains queued work instead of reporting success",
  async (status) => {
    enqueue({ slotId: "s", kind: "start", at: now });
    fetcher().mockResolvedValue(new Response(null, { status }));
    expect(await flushPending()).toBe(0);
    expect(pending()).toHaveLength(1);
    expect(await flushPending()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("Retry-After is honored and a permanent rejection is not counted as delivered", async () => {
  enqueue({ slotId: "s", kind: "start", at: now });
  fetcher()
    .mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  await flushPending();
  vi.setSystemTime(now + 60000);
  await flushPending();
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(now + 120000);
  expect(await flushPending()).toBe(0);
  expect(pending()).toHaveLength(0);
});

test("an online rate limit postpones replay too", async () => {
  fetcher().mockResolvedValueOnce(
    new Response(null, { status: 429, headers: { "retry-after": "120" } }),
  );
  expect(await api.startSlot("s")).toEqual({ queued: true });
  expect(await flushPending()).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(now + 120000);
  fetcher().mockResolvedValueOnce(ok());
  expect(await flushPending()).toBe(1);
});

test("full local storage never produces a false queued acknowledgement", async () => {
  fetcher().mockRejectedValueOnce(new TypeError("offline"));
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
  await expect(api.startSlot("s")).rejects.toThrow("device storage");
  expect(pending()).toHaveLength(0);
  write.mockRestore();
});

test("a lost acknowledgement reuses the online action's ID and concurrent drains share one operation", async () => {
  fetcher().mockRejectedValueOnce(new TypeError("connection closed"));
  expect(await api.startSlot("s")).toEqual({ queued: true });
  const key = pending()[0]?.id;
  expect(fetcher().mock.calls[0]?.[1]?.headers).toMatchObject({
    "idempotency-key": key,
  });
  let reply!: (response: Response) => void;
  fetcher().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const first = flushPending();
  const second = flushPending();
  expect(first).toBe(second);
  expect(fetcher().mock.calls[1]?.[1]?.headers).toMatchObject({
    "idempotency-key": key,
  });
  reply(ok());
  expect(await first).toBe(1);
  expect(pending()).toHaveLength(0);
});

test("reauthentication preserves that account's unsent actions, never another account's", async () => {
  enqueue({ slotId: "a", kind: "start", at: now });
  fetcher().mockResolvedValueOnce(new Response(null, { status: 401 }));
  await flushPending();
  setSessionToken("token-b");
  identifySession("user-b");
  expect(pending()).toEqual([]);
  enqueue({ slotId: "b", kind: "complete", at: now });
  setSessionToken("token-a-new");
  identifySession("user-a");
  expect(pending().map((a) => a.slotId)).toEqual(["a"]);
  fetcher().mockResolvedValueOnce(ok());
  expect(await flushPending()).toBe(1);
});

test("sign-out aborts old requests, clears in-memory state/callbacks, and ignores late responses", async () => {
  publishPlan(plan(), now);
  vi.spyOn(api, "todos").mockResolvedValue([]);
  await reloadTodos();
  const reload = vi.fn();
  publishReload(reload);
  const signal = sessionSignal();
  let reply!: (response: Response) => void;
  fetcher().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const request = api.today();
  const rejected = expect(request).rejects.toThrow("session changed");
  setSessionToken("token-b");
  identifySession("user-b");
  expect(signal.aborted).toBe(true);
  expect(todaySnapshot()).toBeNull();
  expect(todosSnapshot()).toBeNull();
  reloadPlan();
  expect(reload).not.toHaveBeenCalled();
  reply(Response.json(plan()));
  await rejected;
  expect(cachedPlan(now)).toBeNull();
});

test("legacy actions are detected and retained, not attributed to another account", () => {
  const legacy = JSON.stringify([
    { id: "legacy", slotId: "old-slot", kind: "start", at: now },
  ]);
  localStorage.setItem("wiseroutine.pending", legacy);
  expect(hasLegacyPending()).toBe(true);
  expect(pending()).toEqual([]);
  setSessionToken("another-token");
  identifySession("another-user");
  expect(pending()).toEqual([]);
  expect(localStorage.getItem("wiseroutine.pending")).toBe(legacy);
});

test("late completion of an old drain cannot remove the next account's queue", async () => {
  enqueue({ id: "same-id", slotId: "a", kind: "start", at: now });
  let reply!: (response: Response) => void;
  fetcher().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const draining = flushPending();
  setSessionToken("token-b");
  identifySession("user-b");
  enqueue({ id: "same-id", slotId: "b", kind: "start", at: now });
  reply(ok());
  expect(await draining).toBe(0);
  expect(pending()[0]?.slotId).toBe("b");
});

test("privacy opt-out purges cached/in-memory details and redacts an older response", async () => {
  cachePlan(plan(), now);
  publishPlan(plan(), now);
  fetcher().mockResolvedValueOnce(ok());
  await api.updateSettings({ storeEventTitles: false });
  expect(cachedPlan(now)).toBeNull();
  expect(todaySnapshot()?.meetings[0]).toMatchObject({
    title: null,
    description: null,
    joinUrl: null,
  });
  fetcher().mockResolvedValueOnce(Response.json(plan()));
  expect((await api.today()).meetings[0]).toMatchObject({
    title: null,
    description: null,
    joinUrl: null,
  });
});

test("today loads without a Day route, ignores browsed dates, refreshes and starts from the shell", async () => {
  const today = vi.spyOn(api, "today").mockResolvedValue(plan());
  const start = vi.spyOn(api, "startSlot").mockResolvedValue({ queued: false });
  stop = startTodayController();
  await tick();
  expect(todaySnapshot()?.slots[0]?.id).toBe("s");
  publishPlan(
    { ...plan(), dayStart: now + 86400000, dayEnd: now + 2 * 86400000 },
    now,
  );
  await startTodaySlot("s");
  expect(start).toHaveBeenCalledWith("s");
  expect(todaySnapshot()?.slots[0]?.status).toBe("started");
  window.dispatchEvent(new Event("focus"));
  await tick();
  expect(today).toHaveBeenCalledTimes(2);
  stop();
  stop = undefined;
  window.dispatchEvent(new Event("online"));
  await tick();
  expect(today).toHaveBeenCalledTimes(2);
});

test("midnight clears yesterday and stale loads cannot overwrite a newer result", async () => {
  let reply!: (value: Plan) => void;
  const today = vi
    .spyOn(api, "today")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    )
    .mockResolvedValue({ ...plan(), syncedAt: now + 1 });
  stop = startTodayController();
  window.dispatchEvent(new Event("focus"));
  await tick();
  expect(todaySnapshot()?.syncedAt).toBe(now + 1);
  reply(plan());
  await tick();
  expect(todaySnapshot()?.syncedAt).toBe(now + 1);
  today.mockRejectedValue(new Error("offline"));
  vi.setSystemTime(now + 86400000);
  window.dispatchEvent(new Event("focus"));
  await tick();
  expect(todaySnapshot()).toBeNull();
});
