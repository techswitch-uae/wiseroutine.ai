import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { TodayResponse, TodaySlot } from "../lib/api";
import { pick } from "../lib/picked";
import { publishMove, publishPlan, publishStart } from "../lib/plan-store";
import { ThisSlot } from "./this-slot";

/**
 * The rail's answer to "what is this block, and what can I do about it".
 *
 * The timeline is a shape rather than a control panel - a block whose height
 * is five minutes has room for its name and one 20px button - so this is
 * where the actions live. What is worth pinning is that it never offers an
 * action the day would refuse: no nudge on a block that has begun, no Start
 * on one that is over.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    completeSlot: vi.fn(async () => ({ queued: false })),
    skipSlot: vi.fn(async () => ({ queued: false })),
  },
}));

const slot = (over: Partial<TodaySlot> = {}): TodaySlot => ({
  id: "s1",
  title: "Eye rest",
  kind: "recovery",
  startsAt: AT,
  endsAt: AT + 5 * 60_000,
  status: "planned",
  isLocked: false,
  conflictEventId: null,
  presetKey: "eye_rest",
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
    modules: [],
    progress: [],
    ...over,
  }) as unknown as TodayResponse;

const show = (response: TodayResponse, picked: string | null = "s1") => {
  publishPlan(response);
  pick(picked);
  return render(<ThisSlot />);
};

afterEach(() => {
  publishPlan(null);
  pick(null);
});

test("nothing is picked, so there is nothing to say", () => {
  const { container } = show(day(), null);
  expect(container.innerHTML).toBe("");
});

test("names the block, when it is, and how long it runs", () => {
  show(day());
  expect(screen.getByText("Eye rest")).toBeTruthy();
  expect(screen.getByText(/09:00–09:05/)).toBeTruthy();
  expect(screen.getByText(/· 5 min$/)).toBeTruthy();
});

test("a block still ahead of you can be nudged and started", async () => {
  const moved: unknown[] = [];
  const started: string[] = [];
  publishMove((...args) => moved.push(args));
  publishStart((id) => started.push(id));

  const user = userEvent.setup();
  show(day());

  await user.click(screen.getByRole("button", { name: "Later" }));
  expect(moved).toEqual([["s1", AT + 5 * 60_000, AT + 10 * 60_000]]);

  await user.click(screen.getByRole("button", { name: "Start" }));
  expect(started).toEqual(["s1"]);
});

// The same rule the timeline drags by. Two places deciding whether a block can
// move is how they end up disagreeing about it.
test("a block that has begun or is over offers no nudge", () => {
  for (const status of ["started", "completed", "missed"] as const) {
    const view = show(day({ slots: [slot({ status })] }));
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    view.unmount();
  }
});

test("says which of the two reasons it cannot be moved", () => {
  const running = show(day({ slots: [slot({ status: "started" })] }));
  expect(screen.getByText(/Running now/)).toBeTruthy();
  running.unmount();

  show(day({ slots: [slot({ status: "completed" })] }));
  expect(screen.getByText(/^Done\./)).toBeTruthy();
});

/**
 * The gap this closes. A slot with no session of its own could be started and
 * then never finished: the timeline's only control is Start, and everything
 * that completes a slot lived inside a session that this activity does not
 * have.
 */
test("a running block with no session of its own can be finished here", async () => {
  const { api } = await import("../lib/api");
  const user = userEvent.setup();
  show(day({ slots: [slot({ status: "started", presetKey: null })] }));

  await user.click(screen.getByRole("button", { name: "Mark it done" }));
  expect(api.completeSlot).toHaveBeenCalledWith("s1");
});

// One that *does* have a session is stopped from inside it. Two ways to give
// up on the same thing is how "done" and "gave up" start disagreeing.
test("a running session is not also stoppable from the rail", () => {
  show(day({ slots: [slot({ status: "started" })] }));
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

/**
 * Ticking a block off without doing it here has to be possible - you did the
 * stretch away from the desk, or an hour ago - but the session is the thing
 * worth entering. So it is quiet, and it is last in the row.
 */
test("marking it done is offered, quietly, beside Start", () => {
  show(day());
  const buttons = [...document.querySelectorAll(".wr-btn")].map((b) => [
    b.textContent,
    b.className,
  ]);
  expect(buttons).toEqual([
    ["Start", expect.stringContaining("wr-btn-primary")],
    ["Mark it done", expect.stringContaining("wr-btn-quiet")],
  ]);
});

test("nothing is offered for a block that is already over", () => {
  show(day({ slots: [slot({ status: "completed" })] }));
  expect(document.querySelectorAll(".wr-btn")).toHaveLength(0);
});

test("says what a session is going to do before it is started", () => {
  show(day());
  expect(screen.getByText(/the screen dims/)).toBeTruthy();
});

// Someone else's block. We never write back to the calendar it came from, so
// there is nothing to do to it - only something to say.
test("a meeting is described and left alone", () => {
  show(
    day({
      slots: [],
      meetings: [
        {
          id: "m1",
          title: "Design review",
          startsAt: AT,
          endsAt: AT + 3_600_000,
          isAllDay: false,
        },
      ],
    }),
    "m1",
  );
  expect(screen.getByText("Design review")).toBeTruthy();
  expect(screen.getByText(/never writes back/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
});

// Removed, replanned out, or the day rolled over. There is no block to
// describe any more, and describing the last one seen would be a lie.
test("goes quiet when the block it was describing leaves the day", () => {
  const { container } = show(day());
  expect(container.innerHTML).not.toBe("");
  act(() => publishPlan(day({ slots: [] })));
  expect(container.innerHTML).toBe("");
});

/**
 * The X, and the beat it waits.
 *
 * Unmounting on the press takes the card's height with it and everything
 * below jumps up, so it stays for as long as the collapse takes. That is the
 * one bit of the animation this component owns - the widget cannot remove
 * itself, because it does not own the state that decides whether it exists.
 */
test("the X puts it away, after letting it collapse", async () => {
  const user = userEvent.setup();
  const { container } = show(day());

  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(container.innerHTML).not.toBe("");

  await waitFor(() => expect(container.innerHTML).toBe(""));
});
