import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TodayResponse, TodaySlot } from "../lib/api";
import { publishPlan } from "../lib/plan-store";
import { DashboardWidgets } from "./dashboard";

/**
 * "Up next", and when it is there at all.
 *
 * It used to say only how long: the name lived nowhere, and the countdown sat
 * in the head as a static chip - which is upper-cased, so "18m" came out as
 * "18M" and read as a unit nobody uses. It also used to be pinned on every
 * plan, including the ones with nothing left in them.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { missed: vi.fn(async () => []) },
}));

const slot = (over: Partial<TodaySlot> = {}): TodaySlot => ({
  id: "s1",
  title: "Shoulder stretch",
  kind: "recovery",
  startsAt: AT + 18 * 60_000,
  endsAt: AT + 28 * 60_000,
  status: "planned",
  isLocked: false,
  conflictEventId: null,
  ...over,
});

const day = (over: Partial<TodayResponse> = {}): TodayResponse =>
  ({
    date: { year: 2026, month: 8, day: 11 },
    timeZone: "UTC",
    dayStart: AT - 3_600_000,
    dayEnd: AT + 8 * 3_600_000,
    range: "working",
    ranges: [],
    slots: [slot()],
    meetings: [],
    outside: { before: [], after: [] },
    syncedAt: null,
    modules: ["up_next"],
    progress: [],
    ...over,
  }) as unknown as TodayResponse;

beforeEach(() => {
  vi.useFakeTimers({ now: AT, shouldAdvanceTime: true });
});

afterEach(() => {
  publishPlan(null);
  vi.useRealTimers();
});

const show = (response: TodayResponse) => {
  publishPlan(response);
  return render(<DashboardWidgets />);
};

test("names what is coming, not only how far off it is", () => {
  show(day());
  expect(screen.getByText("Shoulder stretch")).toBeTruthy();
});

// A chip, and every static chip in this system is upper-cased. "18M" is not a
// unit anybody writes.
test("writes the countdown as a time, not as a label", () => {
  const { container } = show(day());
  expect(screen.getByText(/in 18m/)).toBeTruthy();
  expect(container.querySelector(".wr-widget-head .wr-chip")).toBeNull();
});

test("offers a start only once the block is actually due", () => {
  const later = show(day());
  expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
  later.unmount();

  show(day({ slots: [slot({ startsAt: AT - 60_000 })] }));
  expect(screen.getByText(/Now/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start now" })).toBeTruthy();
});

// It used to render an ink card reading "Nothing left today." The loudest
// surface in the rail is the wrong place to say nothing: with no name and no
// button on it, it reads as something that failed to load, and it takes the
// top of the rail from the modules that do have something to say.
test("stands down entirely when the day is done", () => {
  const { container } = show(day({ slots: [slot({ status: "completed" })] }));
  expect(container.querySelector(".wr-widget-attention")).toBeNull();
  expect(screen.queryByText("Up next")).toBeNull();
});
