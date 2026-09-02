import { beforeEach, expect, test, vi } from "vitest";
import type { TodayResponse } from "../lib/api";
import { publishPlan, resetPlans } from "../lib/plan-store";
import { resetTodos } from "../lib/todos";
import { testAddon } from "./fixtures";
import { serve } from "./host";

/**
 * The todo handlers, against a fake server.
 *
 * `addons.test.tsx` proves the grant is checked; this proves what a granted
 * addon gets: the list with `fitsAt` worked out by the host, and a placement
 * that lands at that mark when the addon names no time of its own.
 */

const createTodo = vi.fn(async (input: { title: string }) => ({
  id: "t-new",
  title: input.title,
  minutes: 15,
  needsFocus: false,
  createdAt: 0,
}));
const placeTodo = vi.fn(
  async (_id: string, startsAt: number, endsAt: number) => ({
    id: "s1",
    title: "Physio exercises",
    kind: "task",
    startsAt,
    endsAt,
    status: "planned",
    isLocked: true,
    conflictEventId: null,
  }),
);

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    todos: async () => [
      {
        id: "t1",
        title: "Physio exercises",
        minutes: 20,
        needsFocus: false,
        createdAt: 0,
      },
    ],
    createTodo: (input: { title: string }) => createTodo(input),
    placeTodo: (id: string, a: number, b: number) => placeTodo(id, a, b),
  },
}));

const DAY_START = Date.UTC(2026, 8, 1, 8);
const day = (): TodayResponse => ({
  date: { year: 2026, month: 9, day: 1 },
  timeZone: "UTC",
  dayStart: DAY_START,
  dayEnd: Date.UTC(2026, 8, 1, 18),
  range: "working",
  ranges: [],
  slots: [],
  meetings: [],
  outside: { before: [], after: [] },
  syncedAt: null,
  widgets: [],
});

function connectTo() {
  const channel = new MessageChannel();
  const stop = serve(
    channel.port1,
    testAddon({
      capabilities: [{ kind: "read:todos" }, { kind: "write:todos" }],
    }),
    () => ({ kind: "widget", widgetKey: "list", present: () => undefined }),
  );
  channel.port2.start();
  let nextId = 1;
  const call = (method: string, params?: unknown) =>
    new Promise<{ result?: unknown; error?: unknown }>((resolve) => {
      const id = nextId++;
      const onMessage = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        channel.port2.removeEventListener("message", onMessage);
        resolve(event.data);
      };
      channel.port2.addEventListener("message", onMessage);
      channel.port2.postMessage({ id, method, params });
    });
  return { call, stop };
}

beforeEach(() => {
  resetPlans();
  resetTodos();
  vi.clearAllMocks();
  // 11:38 on the day, so the next mark is 11:40.
  vi.useFakeTimers({ now: Date.UTC(2026, 8, 1, 11, 38), toFake: ["Date"] });
  publishPlan(day(), Date.UTC(2026, 8, 1, 11, 38));
});

test("the list carries where each todo would land, and placing one lands it there", async () => {
  const { call, stop } = connectTo();

  const listed = await call("todos.list");
  expect(listed.result).toEqual([
    {
      id: "t1",
      title: "Physio exercises",
      minutes: 20,
      needsFocus: false,
      fitsAt: Date.UTC(2026, 8, 1, 11, 40),
    },
  ]);

  const placed = await call("todos.place", { id: "t1" });
  expect(placed.error).toBeUndefined();
  expect(placeTodo).toHaveBeenCalledWith(
    "t1",
    Date.UTC(2026, 8, 1, 11, 40),
    Date.UTC(2026, 8, 1, 12, 0),
  );
  expect((placed.result as { startsAt: number }).startsAt).toBe(
    Date.UTC(2026, 8, 1, 11, 40),
  );

  const added = await call("todos.add", {
    title: "  Reply to Anders ",
    minutes: 15,
  });
  expect(createTodo).toHaveBeenCalledWith({
    title: "Reply to Anders",
    minutes: 15,
  });
  expect((added.result as { id: string }).id).toBe("t-new");

  stop();
  vi.useRealTimers();
});
