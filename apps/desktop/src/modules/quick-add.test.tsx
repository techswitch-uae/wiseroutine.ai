import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ActivityResponse, TodayResponse } from "../lib/api";
import { publishPlan, resetPlans } from "../lib/plan-store";
import { resetTodos } from "../lib/todos";
import { QuickAdd } from "./quick-add";

/**
 * The dialog, driven from the keyboard - which is the whole point of it.
 *
 * The day is built around the real clock rather than a frozen one: the plan
 * store only holds a plan whose date is today, and `userEvent` and fake
 * timers do not get on. What is asserted is therefore about shape - on the
 * grid, not in the past - rather than a particular minute.
 */

const placeSlot = vi.fn(async () => undefined);
const placeTodo = vi.fn(async () => undefined);
const createTodo = vi.fn(async (input: { title: string }) => ({
  id: "t-new",
  title: input.title,
  minutes: 15,
  needsFocus: false,
  createdAt: 0,
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    activities: async (): Promise<Partial<ActivityResponse>[]> => [
      {
        id: "a1",
        name: "Stretch",
        kind: "recovery",
        isActive: true,
        sessionMinutes: 10,
      },
    ],
    todos: async () => [
      {
        id: "t1",
        title: "Physio exercises",
        minutes: 20,
        needsFocus: false,
        createdAt: 0,
      },
    ],
    scope: async () => ({ days: [] }),
    today: async () => day(),
    placeSlot: (...args: unknown[]) => placeSlot(...(args as [])),
    placeTodo: (...args: unknown[]) => placeTodo(...(args as [])),
    createTodo: (...args: unknown[]) =>
      createTodo(...(args as [{ title: string }])),
  },
}));

/** Today in UTC, from an hour ago to eight hours from now, with nothing on it. */
const day = (): TodayResponse => {
  const now = Date.now();
  const [year, month, dayOfMonth] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(now))
    .split("-")
    .map(Number);
  return {
    date: { year: year ?? 0, month: month ?? 0, day: dayOfMonth ?? 0 },
    timeZone: "UTC",
    dayStart: now - 3_600_000,
    dayEnd: now + 8 * 3_600_000,
    range: "full",
    ranges: [],
    slots: [],
    meetings: [],
    outside: { before: [], after: [] },
    syncedAt: null,
    widgets: [],
  };
};

beforeEach(() => {
  resetPlans();
  resetTodos();
  publishPlan(day());
});

afterEach(() => {
  vi.clearAllMocks();
});

const onGrid = (at: number) => at % 300_000 === 0 && at >= Date.now() - 1;

test("⌘1 drops the first chip at the next mark, with no second keystroke", async () => {
  const user = userEvent.setup();
  render(<QuickAdd onClose={() => undefined} />);
  await screen.findByRole("button", { name: /Stretch/ });

  await user.keyboard("{Meta>}1{/Meta}");

  await waitFor(() => expect(placeSlot).toHaveBeenCalledTimes(1));
  const [activityId, startsAt, endsAt] = placeSlot.mock.calls[0] as unknown as [
    string,
    number,
    number,
  ];
  expect(activityId).toBe("a1");
  expect(onGrid(startsAt)).toBe(true);
  expect(endsAt - startsAt).toBe(10 * 60_000);
});

test("typing something new, ↵, ↵ makes a todo and puts it on the day", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<QuickAdd onClose={onClose} />);
  await screen.findByRole("button", { name: /Physio exercises/ });

  await user.keyboard("Reply to Anders{Enter}");
  // The "when" step: the length pills and the first gap, which is now.
  expect(screen.getByText("Now, on the grid")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "15 min" })).toBeInTheDocument();

  // Tab moves the length along one pill; ↵ takes the highlighted row.
  await user.keyboard("{Tab}{Enter}");

  await waitFor(() => expect(placeTodo).toHaveBeenCalledTimes(1));
  expect(createTodo).toHaveBeenCalledWith({
    title: "Reply to Anders",
    minutes: 20,
  });
  const [todoId, startsAt, endsAt] = placeTodo.mock.calls[0] as unknown as [
    string,
    number,
    number,
  ];
  expect(todoId).toBe("t-new");
  expect(onGrid(startsAt)).toBe(true);
  expect(endsAt - startsAt).toBe(20 * 60_000);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("a waiting todo is picked from the list and placed as itself", async () => {
  const user = userEvent.setup();
  render(<QuickAdd onClose={() => undefined} />);
  await screen.findByRole("button", { name: /Physio exercises/ });

  await user.keyboard("{Enter}{Enter}");

  await waitFor(() => expect(placeTodo).toHaveBeenCalledTimes(1));
  expect(createTodo).not.toHaveBeenCalled();
  expect((placeTodo.mock.calls[0] as unknown as [string])[0]).toBe("t1");
});
