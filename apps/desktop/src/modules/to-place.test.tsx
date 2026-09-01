import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TodayResponse } from "../lib/api";
import { setPlacing } from "../lib/placing";
import { publishPlan, publishReload, resetPlans } from "../lib/plan-store";
import { ToPlace } from "./to-place";

/**
 * Putting a session on the day by hand.
 *
 * The card used to name what the day owed and offer exactly one way to deal
 * with it - the scheduler's choice or nothing. A row is now dragged onto the
 * timeline and lands where it was dropped, which is the whole point of doing
 * it by hand: the stretch after lunch rather than wherever a gap happened to
 * be.
 */

/** 09:00 UTC, and a day drawn from 08:00 to 18:00. */
const AT = Date.UTC(2026, 8, 1, 9, 0);
const DAY_START = Date.UTC(2026, 8, 1, 8, 0);
const DAY_END = Date.UTC(2026, 8, 1, 18, 0);

const placeSlot = vi.fn(async () => undefined);
const plan = vi.fn(async () => ({ placed: 1, unplaced: [] }));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    placeSlot: (...args: unknown[]) => placeSlot(...(args as [])),
    plan: (...args: unknown[]) => plan(...(args as [])),
  },
}));

const day = (): TodayResponse =>
  ({
    date: { year: 2026, month: 9, day: 1 },
    timeZone: "UTC",
    dayStart: DAY_START,
    dayEnd: DAY_END,
    range: "working",
    ranges: [],
    slots: [],
    meetings: [],
    outside: { before: [], after: [] },
    syncedAt: null,
    modules: [],
    progress: [
      {
        id: "a1",
        name: "Shoulder stretch",
        kind: "recovery",
        minimumType: "countPerDay",
        minimumValue: 3,
        sessionMinutes: 10,
        count: 0,
        minutes: 0,
        scheduled: 1,
      },
    ],
  }) as unknown as TodayResponse;

/**
 * The day, at a size the drop can be computed against.
 *
 * jsdom lays nothing out, so the one measurement this depends on is stubbed:
 * the grid's own rectangle. Everything else - the scale, the snap, the clamp -
 * is the same arithmetic the timeline runs.
 */
const grid = (): HTMLElement => {
  const element = document.createElement("div");
  element.className = "wr-daygrid";
  element.getBoundingClientRect = () =>
    ({ top: 100, left: 300, right: 900, bottom: 2000 }) as DOMRect;
  document.body.append(element);
  return element;
};

const at = (type: string, x: number, y: number): MouseEvent =>
  new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });

beforeEach(() => {
  vi.useFakeTimers({ now: AT, shouldAdvanceTime: true });
  placeSlot.mockClear();
  plan.mockClear();
  publishReload(() => undefined);
});

afterEach(() => {
  // Module state outlives a case; a drag left in flight would be picked up by
  // the next one.
  setPlacing(null);
  resetPlans();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

test("says how much of the day's minimum is still unplaced", () => {
  publishPlan(day());
  render(<ToPlace />);
  // One of the three is already on the day, so two are owed. Nothing here
  // says "today": the card describes the day on screen, which the day view
  // can page away from.
  expect(screen.getByText("10 min · 2 of 3")).toBeTruthy();
  expect(screen.queryByText(/today/i)).toBeNull();
});

test("places a session where it was dropped", () => {
  publishPlan(day());
  const { container } = render(<ToPlace />);
  grid();

  const handle = container.querySelector(".wr-grip");
  if (!handle) throw new Error("no drag handle");

  act(() => {
    handle.dispatchEvent(at("pointerdown", 100, 100));
  });
  // 128px down the grid. The default density draws a quarter hour in 64px, so
  // that is half an hour past the day's start - and on the ruler, not between
  // two lines of it.
  act(() => {
    globalThis.dispatchEvent(at("pointermove", 500, 228));
  });
  act(() => {
    globalThis.dispatchEvent(at("pointerup", 500, 228));
  });

  expect(placeSlot).toHaveBeenCalledWith(
    "a1",
    DAY_START + 30 * 60_000,
    DAY_START + 40 * 60_000,
  );
});

test("releasing away from the day places nothing", () => {
  publishPlan(day());
  const { container } = render(<ToPlace />);
  grid();

  const handle = container.querySelector(".wr-grip");
  if (!handle) throw new Error("no drag handle");

  act(() => {
    handle.dispatchEvent(at("pointerdown", 100, 100));
  });
  // Well left of the grid's own rectangle: the rail, which is not the day.
  act(() => {
    globalThis.dispatchEvent(at("pointermove", 100, 400));
  });
  act(() => {
    globalThis.dispatchEvent(at("pointerup", 100, 400));
  });

  expect(placeSlot).not.toHaveBeenCalled();
});

/**
 * One release, one session.
 *
 * The request used to live inside the state updater that cleared the drag -
 * which React calls twice in development to catch exactly this kind of
 * impurity. So one drop placed two sessions, and dragging the first of two
 * breathing blocks put both of them on the day at once.
 */
test("places one session per drop, however often the release fires", () => {
  publishPlan(day());
  const { container } = render(<ToPlace />);
  grid();

  const handle = container.querySelector(".wr-grip");
  if (!handle) throw new Error("no drag handle");

  act(() => {
    handle.dispatchEvent(at("pointerdown", 100, 100));
  });
  act(() => {
    globalThis.dispatchEvent(at("pointermove", 500, 228));
  });
  act(() => {
    globalThis.dispatchEvent(at("pointerup", 500, 228));
    globalThis.dispatchEvent(at("pointerup", 500, 228));
  });

  expect(placeSlot).toHaveBeenCalledTimes(1);
});

/**
 * "Place them for me", on the day being looked at.
 *
 * The server plans the day it is currently in unless it is told otherwise, so
 * pressing this while paged forward to Thursday quietly filled today instead -
 * a card describing one day and a button acting on another.
 */
test("auto-placing fills the day on screen, not the day it is", async () => {
  const user = userEvent.setup();
  publishPlan(day());
  render(<ToPlace />);

  await user.click(screen.getByRole("button", { name: "Place them for me" }));

  const [, at] = plan.mock.calls[0] as unknown as [string, number];
  expect(at).toBeGreaterThanOrEqual(DAY_START);
  expect(at).toBeLessThanOrEqual(DAY_END);
});
