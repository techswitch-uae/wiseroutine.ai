import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TodayResponse, TodaySlot } from "../lib/api";
import { pick } from "../lib/picked";
import { publishMove, publishPlan, publishStart } from "../lib/plan-store";
import { ThisSlot } from "./this-slot";

/** Where a press on Join ends up. The real one hands the URL to the operating
 *  system, which a test has no business doing. */
const opened: string[] = [];
vi.mock("../lib/open-external", () => ({
  openExternal: async (url: string) => {
    opened.push(url);
    return true;
  },
}));

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

/**
 * A clock, because the card now needs one.
 *
 * `slotState` reads the time as well as the status - a block started
 * yesterday is not "running now" - so a fixture dated 2026 would otherwise be
 * read against the real clock and every one of these blocks would be long
 * over. Pinned a minute into the block, which is where every case that is not
 * about the clock means to stand.
 */
beforeEach(() => {
  vi.useFakeTimers({ now: AT + 60_000, shouldAdvanceTime: true });
});

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    completeSlot: vi.fn(async () => ({ queued: false })),
    skipSlot: vi.fn(async () => ({ queued: false })),
  },
}));

vi.mock("../lib/notify", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notify: vi.fn(),
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
  opened.length = 0;
  publishPlan(null);
  pick(null);
  vi.useRealTimers();
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

  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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

/**
 * The block this whole pass exists for: a five-minute breathing session that
 * was started and then left.
 *
 * A manual session is finished from inside itself, so shutting the window
 * mid-stretch leaves the row `started` with nothing to close it - and the card
 * used to read it by status alone. It said "Running now" about a block from
 * yesterday, and stopping it offered to "resume it while its time is still
 * running". The server does eventually record it as missed, an hour after the
 * end; until then this is the only place the truth can be told.
 */
test("a block left started overnight asks what happened", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const yesterday = AT - 24 * 3_600_000;
  show(
    day({
      slots: [
        slot({
          status: "started",
          startsAt: yesterday,
          endsAt: yesterday + 5 * 60_000,
        }),
      ],
    }),
  );

  // Not running, and not something to carry on with.
  expect(screen.queryByText(/Running now/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();

  // The two answers that are actually available.
  expect(screen.getByRole("button", { name: "Mark it done" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "It didn't happen" }));

  const { api } = await import("../lib/api");
  expect(api.skipSlot).toHaveBeenCalledWith("s1");
});

test("marking an abandoned block done actually records it", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const yesterday = AT - 24 * 3_600_000;
  show(
    day({
      slots: [
        slot({
          status: "started",
          startsAt: yesterday,
          endsAt: yesterday + 5 * 60_000,
        }),
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Mark it done" }));
  const { api } = await import("../lib/api");
  expect(api.completeSlot).toHaveBeenCalledWith("s1");
});

/**
 * A press must never be silent.
 *
 * `slotAction` answers `{ queued: true }` when it could not reach the server
 * and wrote the action down instead. That answer used to be discarded: nothing
 * rejected, so no toast fired, and the card could easily redraw unchanged - a
 * button that swallowed the press whole. Whatever else is true, a control that
 * gives no acknowledgement at all is indistinguishable from a dead one.
 */
test("says so when the action could only be queued", async () => {
  const { api } = await import("../lib/api");
  const { notify } = await import("../lib/notify");
  vi.mocked(api.completeSlot).mockResolvedValueOnce({ queued: true });

  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  show(day({ slots: [slot({ status: "started" })] }));
  await user.click(screen.getByRole("button", { name: "Mark it done" }));

  await waitFor(() => expect(notify).toHaveBeenCalled());
  expect(vi.mocked(notify).mock.calls[0]?.[0]).toMatch(/offline/i);
});

test("stays quiet when the action actually went through", async () => {
  const { api } = await import("../lib/api");
  const { notify } = await import("../lib/notify");
  vi.mocked(notify).mockClear();

  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  show(day({ slots: [slot({ status: "started" })] }));
  await user.click(screen.getByRole("button", { name: "Mark it done" }));

  // Let the resolved promise and its `.finally` settle before asserting the
  // absence of a toast - otherwise this passes for the wrong reason.
  await waitFor(() => expect(api.completeSlot).toHaveBeenCalled());
  expect(notify).not.toHaveBeenCalled();
});

/**
 * The card is put away by more than its own X: pressing the day behind the
 * rail, or paging to another day, clears the selection too. Those used to go
 * from a full card to nothing in one frame, taking the card's height with them
 * and jumping everything below up.
 */
test("collapses when the selection is cleared from outside", () => {
  show(day());
  act(() => {
    pick(null);
  });
  // Still mounted, and on its way out.
  expect(screen.getByText("Eye rest")).toBeTruthy();

  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(screen.queryByText("Eye rest")).toBeNull();
});

/**
 * The one thing that can be done to someone else's block.
 *
 * Both providers have always sent the link; it was read off the wire and
 * thrown away, so a card could say when a call was and never how to get into
 * it. It opens in the real browser - the one already signed in to it - and
 * never in the app's own webview, which would replace the app.
 */
test("offers the meeting's own join link, named by where it goes", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
          joinUrl: "https://meet.google.com/abc-defg-hij",
        },
      ],
    }),
    "m1",
  );

  const join = screen.getByRole("button", { name: "Join Google Meet" });
  await user.click(join);
  expect(opened).toEqual(["https://meet.google.com/abc-defg-hij"]);
});

// Most meetings are in a room. A button that opens nothing is worse than no
// button.
test("says nothing about joining a meeting that is not online", () => {
  show(
    day({
      slots: [],
      meetings: [
        {
          id: "m1",
          title: "Standup",
          startsAt: AT,
          endsAt: AT + 900_000,
          isAllDay: false,
          joinUrl: null,
        },
      ],
    }),
    "m1",
  );
  expect(screen.queryByRole("button", { name: /^Join/ })).toBeNull();
});
