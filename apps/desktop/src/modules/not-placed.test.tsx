import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BucketItem, TodayResponse } from "../lib/api";
import { setPlacing } from "../lib/placing";
import { publishPlan, publishReload, resetPlans } from "../lib/plan-store";
import { NotPlaced } from "./not-placed";

const AT = Date.UTC(2026, 8, 1, 9);
const M = 60_000;
const bucket = vi.fn(async (): Promise<BucketItem[]> => []);
const placeSlot = vi.fn(async () => undefined);
const moveSlot = vi.fn(async () => undefined);
const plan = vi.fn(async () => ({
  placed: 1,
  unplaced: [] as { sessions: number }[],
}));
const notify = vi.fn();
vi.mock("../lib/notify", () => ({
  notify: (...args: unknown[]) => notify(...args),
}));
vi.mock("../lib/capture", () => ({ refreshCaptured: () => undefined }));
vi.mock("../lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  api: {
    bucket: (...args: unknown[]) => bucket(...(args as [])),
    placeSlot: (...args: unknown[]) => placeSlot(...(args as [])),
    moveSlot: (...args: unknown[]) => moveSlot(...(args as [])),
    plan: (...args: unknown[]) => plan(...(args as [])),
  },
}));
const day = (scheduled = 1): TodayResponse =>
  ({
    date: { year: 2026, month: 9, day: 1 },
    timeZone: "UTC",
    dayStart: AT - 60 * M,
    dayEnd: AT + 9 * 60 * M,
    slots: [],
    meetings: [],
    outside: { before: [], after: [] },
    widgets: [],
    progress: [
      {
        id: "a1",
        name: "Stretch",
        kind: "recovery",
        minimumType: "countPerDay",
        minimumValue: 3,
        sessionMinutes: 10,
        count: 0,
        minutes: 0,
        scheduled,
      },
    ],
  }) as unknown as TodayResponse;
const saved = (id: string): BucketItem => ({
  id,
  activityId: "a1",
  title: "Stretch",
  kind: "recovery",
  startsAt: AT,
  endsAt: AT + 10 * M,
  wasAt: AT,
  initiallyUnplaced: true,
  reasonCode: "no_gap",
  suggested: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: AT });
  vi.clearAllMocks();
  bucket.mockResolvedValue([]);
  plan.mockResolvedValue({ placed: 2, unplaced: [] });
  publishReload(() => undefined);
});
afterEach(() => {
  setPlacing(null);
  resetPlans();
  vi.useRealTimers();
});
const ready = async () => {
  const button = await screen.findByRole("button", {
    name: "Place them for me",
  });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};
const grip = () => screen.getByRole("button", { name: /^Place Stretch\./ });
const grid = () => {
  const element = document.createElement("div");
  element.className = "wr-daygrid";
  element.getBoundingClientRect = () =>
    ({ top: 100, left: 300, right: 900, bottom: 2000 }) as DOMRect;
  document.body.append(element);
  return element;
};
const point = (type: string, x: number, y: number) =>
  globalThis.dispatchEvent(
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }),
  );

test("fresh demand uses a passive state label and no dismiss or change-time buttons", async () => {
  publishPlan(day());
  render(<NotPlaced />);
  await ready();
  expect(screen.getByText("Not placed")).toBeVisible();
  expect(screen.getByText("10 min · 2 slots")).toBeVisible();
  expect(screen.queryByText("To place")).toBeNull();
  expect(screen.queryByRole("button", { name: /Drop|Choose time/ })).toBeNull();
});

test("saved slots and fresh demand share one row without double counting", async () => {
  bucket.mockResolvedValue([saved("s1"), saved("s2")]);
  publishPlan(day(2));
  const view = render(<NotPlaced />);
  await ready();
  expect(screen.getAllByText("Stretch")).toHaveLength(1);
  expect(screen.getByText("10 min · 3 slots")).toBeVisible();
  expect(
    view.container.querySelector(".wr-widget-head .wr-chip"),
  ).toHaveTextContent("3");
});

test.each([false, true])(
  "a drag places one occurrence, retaining identity when saved=%s",
  async (existing) => {
    if (existing) bucket.mockResolvedValue([saved("s1")]);
    publishPlan(day(existing ? 3 : 1));
    render(<NotPlaced />);
    await ready();
    const target = grid();
    fireEvent.pointerDown(grip(), { button: 0, clientX: 100, clientY: 100 });
    act(() => {
      point("pointermove", 500, 484);
    }); // 09:30
    act(() => {
      point("pointerup", 500, 484);
      point("pointerup", 500, 484);
    });
    await waitFor(() =>
      expect(existing ? moveSlot : placeSlot).toHaveBeenCalledTimes(1),
    );
    expect(existing ? moveSlot : placeSlot).toHaveBeenCalledWith(
      existing ? "s1" : "a1",
      AT + 30 * M,
      AT + 40 * M,
    );
    expect(existing ? placeSlot : moveSlot).not.toHaveBeenCalled();
    target.remove();
  },
);

test("releasing off the timeline cancels without losing the slot", async () => {
  publishPlan(day());
  render(<NotPlaced />);
  await ready();
  const target = grid();
  fireEvent.pointerDown(grip(), { button: 0, clientX: 100, clientY: 100 });
  act(() => {
    point("pointermove", 100, 400);
  });
  act(() => {
    point("pointerup", 100, 400);
  });
  expect(placeSlot).not.toHaveBeenCalled();
  expect(screen.getByText("Stretch")).toBeVisible();
  target.remove();
});

test("keyboard users can pick up, move, place and cancel from the same grip", async () => {
  publishPlan(day());
  render(<NotPlaced />);
  await ready();
  fireEvent.keyDown(grip(), { key: "Enter" });
  expect(screen.getByRole("status")).toHaveTextContent("Stretch at 9:00");
  fireEvent.keyDown(grip(), { key: "ArrowDown" });
  fireEvent.keyDown(grip(), { key: "Enter" });
  await waitFor(() =>
    expect(placeSlot).toHaveBeenCalledWith("a1", AT + 5 * M, AT + 15 * M),
  );
  await ready();
  fireEvent.keyDown(grip(), { key: "Enter" });
  fireEvent.keyDown(grip(), { key: "Escape" });
  expect(screen.queryByRole("status")).toBeNull();
  expect(placeSlot).toHaveBeenCalledTimes(1);
});

test("Place them for me uses the viewed day and toasts when no space remains", async () => {
  bucket.mockResolvedValue([saved("s1"), saved("s2"), saved("s3")]);
  plan.mockResolvedValue({ placed: 0, unplaced: [{ sessions: 3 }] });
  publishPlan(day(3));
  render(<NotPlaced />);
  await userEvent.click(await ready());
  expect(plan).toHaveBeenCalledWith("user_request", AT + 4 * 60 * M);
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(
      "No space on this day. Your slots are still in Not placed.",
    ),
  );
  expect(screen.getByText("Stretch")).toBeVisible();
});

test("another tab already placing slots is not reported as a lack of space", async () => {
  plan.mockResolvedValue({ placed: 0, unplaced: [] });
  publishPlan(day());
  render(<NotPlaced />);
  await userEvent.click(await ready());
  await waitFor(() => expect(plan).toHaveBeenCalledTimes(1));
  expect(notify).not.toHaveBeenCalled();
});

test("a failed automatic placement keeps slots available", async () => {
  plan.mockRejectedValueOnce(new Error("offline"));
  publishPlan(day());
  render(<NotPlaced />);
  await userEvent.click(await ready());
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(
      "Couldn't place your slots just now. They're still here.",
    ),
  );
  expect(screen.getByText("10 min · 2 slots")).toBeVisible();
});

test("a failed read is recoverable, not an empty widget or fresh duplicate demand", async () => {
  bucket.mockRejectedValueOnce(new Error("offline"));
  publishPlan(day());
  render(<NotPlaced />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load");
  expect(
    screen.getByRole("button", { name: "Place them for me" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  expect(screen.queryByRole("alert")).toBeNull();
});
