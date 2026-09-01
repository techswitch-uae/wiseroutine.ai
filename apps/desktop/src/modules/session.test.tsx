import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TodayResponse, TodaySlot } from "../lib/api";
import { publishPlan, publishReload } from "../lib/plan-store";
import { forgetStarted, markStarted } from "../lib/running-slot";
import { SessionOverlay } from "./session";

/**
 * Stopping a session, and picking it back up.
 *
 * The overlay closes itself the moment you press Stop, before the server has
 * answered - a session that lingered while a round trip finished would read
 * as the button not working. That dismissal is remembered by slot id, and is
 * meant to be forgotten as soon as the day agrees the slot is no longer
 * running.
 *
 * It was not, because nothing re-read the day: the plan in hand still said
 * `started` long after the skip had been recorded, so the dismissal never
 * cleared, and pressing Start again reloaded a day that already said
 * `started`, found the slot still dismissed, and did nothing. The button sat
 * there looking pressable forever.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    skipSlot: vi.fn(async () => ({ queued: false })),
    completeSlot: vi.fn(async () => ({ queued: false })),
  },
}));

const slot = (status: TodaySlot["status"]): TodaySlot => ({
  id: "s1",
  title: "Eye rest",
  kind: "recovery",
  startsAt: AT,
  endsAt: AT + 5 * 60_000,
  status,
  isLocked: false,
  conflictEventId: null,
  presetKey: "eye_rest",
});

const day = (status: TodaySlot["status"]): TodayResponse =>
  ({
    date: { year: 2026, month: 8, day: 11 },
    timeZone: "UTC",
    dayStart: AT,
    dayEnd: AT + 8 * 3_600_000,
    range: "working",
    ranges: [],
    slots: [slot(status)],
    meetings: [],
    outside: { before: [], after: [] },
    syncedAt: null,
    widgets: [],
    progress: [],
  }) as unknown as TodayResponse;

beforeEach(() => {
  vi.useFakeTimers({ now: AT, shouldAdvanceTime: true });
  // Pressing Start is what lets a session take the window - see
  // `lib/running-slot`. These cases stand in for that press.
  forgetStarted();
  markStarted("s1");
});

afterEach(() => {
  publishPlan(null);
  publishReload(() => undefined);
});

test("a stopped session can be started again", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  // The page's reload, as the app wires it: the day is re-read and whatever
  // the server now says is published.
  let onDisk = day("started");
  publishReload(() => act(() => publishPlan(onDisk)));

  publishPlan(onDisk);
  render(<SessionOverlay />);
  expect(screen.getByRole("dialog")).toBeTruthy();

  // Stopping records a skip - and the day has to be re-read, or nothing else
  // here can be true.
  onDisk = day("skipped");
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  // Pressing Start puts it back to `started`. The session has to come back
  // with it: the dismissal was about one press, not about this slot forever.
  onDisk = day("started");
  act(() => publishPlan(onDisk));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("a finished session does not reopen on the same plan", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  // The plan in hand still says `started` until the reload lands, which is
  // the whole reason the dismissal exists.
  publishReload(() => undefined);
  publishPlan(day("started"));
  render(<SessionOverlay />);

  await user.click(screen.getByRole("button", { name: "Done early" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  act(() => publishPlan(day("started")));
  expect(screen.queryByRole("dialog")).toBeNull();
});

/**
 * A block pressed before its window opens.
 *
 * The countdown used to run to where the block is parked on the day, so a
 * five-minute rest started four minutes early opened saying nine. What was
 * asked for is five minutes of rest, and the press is the only thing that
 * knows when they began.
 */
test("runs for as long as the block was planned, not until it was parked", () => {
  const early = AT - 4 * 60_000;
  vi.setSystemTime(early);
  forgetStarted();
  markStarted("s1", early);

  publishPlan(day("started"));
  render(<SessionOverlay />);

  // 5:00 of rest, not the 9:00 between the press and the block's own end.
  expect(screen.getByText("5:00")).toBeTruthy();
  expect(screen.queryByText("9:00")).toBeNull();
});
