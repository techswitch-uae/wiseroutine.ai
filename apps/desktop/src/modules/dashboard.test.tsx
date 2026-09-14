import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TodayResponse, TodaySlot } from "../lib/api";
import { publishPlan } from "../lib/plan-store";
import { Bucket, DashboardWidgets } from "./dashboard";

/**
 * "Up next", and when it is there at all.
 *
 * It used to say only how long: the name lived nowhere, and the countdown sat
 * in the head as a static chip - which is upper-cased, so "18m" came out as
 * "18M" and read as a unit nobody uses. It also used to be pinned on every
 * plan, including the ones with nothing left in them.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

const bucket = vi.fn(async (): Promise<unknown[]> => []);
const placing = vi.fn();
vi.mock("../lib/placing", () => ({ setPlacing: (p: unknown) => placing(p) }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    missed: vi.fn(async () => []),
    bucket: (...a: unknown[]) => bucket(...(a as [])),
  },
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
    widgets: ["up_next"],
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

test("Up next withdraws Start as soon as the slot starts, then follows the next activity", () => {
  const current = slot({ startsAt: AT, endsAt: AT + 10 * 60_000 });
  const later = slot({ id: "s2", title: "Walk" });
  show(day({ slots: [current, later] }));
  expect(screen.getByRole("button", { name: "Start now" })).toBeTruthy();
  act(() =>
    publishPlan(day({ slots: [{ ...current, status: "started" }, later] })),
  );
  expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
  expect(screen.queryByText("Shoulder stretch")).toBeNull();
  expect(screen.getByText("Walk")).toBeTruthy();
});

// It used to render an ink card reading "Nothing left today." The loudest
// surface in the rail is the wrong place to say nothing: with no name and no
// button on it, it reads as something that failed to load, and it takes the
// top of the rail from the widgets that do have something to say.
test("stands down entirely when the day is done", () => {
  const { container } = show(day({ slots: [slot({ status: "completed" })] }));
  expect(container.querySelector(".wr-widget-attention")).toBeNull();
  expect(screen.queryByText("Up next")).toBeNull();
});

/**
 * The day card moved out of this file entirely.
 *
 * It is `addons/day-so-far` now - a widget-only addon, drawn in a sandboxed
 * frame from data it reads over the port. Its rules are asserted directly in
 * `addons/day-so-far/src/day.test.ts`, which is the better test: they are
 * rules about counting, and they were being checked here by reading a sentence
 * off a screen.
 *
 * What is left in this file is the four first-party keys the *plan* grants,
 * which is what `DashboardWidgets` still decides. An addon's card is not one
 * of those - it is on screen because the user switched that addon on - so
 * nothing here can assert it without mounting a frame jsdom will not run.
 */

test("Unscheduled slots folds one activity's sessions into one draggable row", async () => {
  const unplaced = (id: string) => ({
    id,
    activityId: "a1",
    title: "Evening stretch",
    kind: "recovery",
    wasAt: AT,
    startsAt: AT,
    endsAt: AT + 10 * 60_000,
    reasonCode: "no_gap",
    suggested: null,
    initiallyUnplaced: true,
  });
  bucket.mockResolvedValue([unplaced("s1"), unplaced("s2"), unplaced("s3")]);
  publishPlan(day());
  const { container } = render(<Bucket />);

  expect(await screen.findByText("Evening stretch")).toBeTruthy();
  expect(screen.getAllByText("Evening stretch")).toHaveLength(1);
  // Once in the widget head (three slots), once on the row (three of this).
  expect(screen.getAllByText("3")).toHaveLength(2);

  const handle = container.querySelector(".wr-grip");
  if (!handle) throw new Error("no drag handle");
  act(() => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, bubbles: true }),
    );
  });
  expect(placing).toHaveBeenCalledWith(
    expect.objectContaining({ slotId: "s1", activityId: "a1", minutes: 10 }),
  );
});
