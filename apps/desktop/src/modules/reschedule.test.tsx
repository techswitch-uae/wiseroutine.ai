import "../test-support/future-features";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Reschedule } from "./reschedule";

const move = vi.fn();
afterEach(() => vi.useRealTimers());
vi.mock("../lib/api", () => ({
  api: { rescheduleSlot: (...args: unknown[]) => move(...args) },
}));
vi.mock("../lib/capture", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  refreshCaptured: vi.fn(),
}));
test("a stale reschedule dialog cannot postpone a now-started slot", () => {
  render(
    <Reschedule
      slot={{
        id: "running",
        title: "Reading",
        status: "started",
        startsAt: Date.now(),
        endsAt: Date.now() + 600_000,
      }}
      timeZone="UTC"
      onClose={() => undefined}
    />,
  );
  expect(screen.queryByRole("button", { name: "Move slot" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to inbox" })).toBeNull();
  expect(screen.getByText(/can no longer be moved/)).toBeTruthy();
});

test("changing the time after an unconfirmed reschedule keeps its idempotency key", async () => {
  const user = userEvent.setup(),
    close = vi.fn(),
    startsAt = Math.ceil((Date.now() + 3600000) / 60000) * 60000;
  move
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({ slotId: "replacement" });
  render(
    <Reschedule
      slot={{
        id: "slot",
        title: "Reading",
        status: "skipped",
        startsAt,
        endsAt: startsAt + 1200000,
      }}
      timeZone="UTC"
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Move slot" }));
  await screen.findByText("Response lost");
  await user.click(screen.getByRole("button", { name: "Tomorrow" }));
  await user.click(screen.getByRole("button", { name: "Move slot" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(move).toHaveBeenCalledTimes(2);
  expect(move.mock.calls[0]?.[1]).not.toEqual(move.mock.calls[1]?.[1]);
  expect(move.mock.calls[0]?.[2]).toBe(move.mock.calls[1]?.[2]);
  expect(move.mock.calls[0]?.[3]).toBe(move.mock.calls[1]?.[3]);
});

test("an open Postpone dialog expires without a refresh and offers no copy", () => {
  const startsAt = Date.UTC(2026, 7, 11, 9);
  vi.useFakeTimers({ now: startsAt + 119_999 });
  move.mockClear();
  render(
    <Reschedule
      slot={{
        id: "stopped",
        title: "Reading",
        status: "skipped",
        startsAt,
        endsAt: startsAt + 600_000,
      }}
      timeZone="UTC"
      onClose={() => undefined}
    />,
  );
  expect(screen.getByRole("button", { name: "Move slot" })).toBeTruthy();
  expect(screen.queryByText(/creates a new|original session stays/)).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("button", { name: "Move slot" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to inbox" })).toBeNull();
  expect(screen.getByText(/can no longer be moved/)).toBeTruthy();
  expect(move).not.toHaveBeenCalled();
});

test("the length steps by the activity rule, never past eight hours", async () => {
  const user = userEvent.setup();
  render(
    <Reschedule
      slot={{
        id: "slot",
        title: "Walk",
        status: "planned",
        startsAt: Date.now() + 3600000,
        endsAt: Date.now() + 3600000 + 15 * 60000,
      }}
      timeZone="UTC"
      onClose={() => undefined}
    />,
  );
  expect(screen.getByText("15 min")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "How long: more" }));
  expect(screen.getByText("20 min")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "30 minutes later" })).toBeNull();
});
