import "../test-support/future-features";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Reschedule } from "./reschedule";

const move = vi.fn();
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
  expect(screen.queryByRole("button", { name: "30 minutes later" })).toBeNull();
  expect(screen.getByText(/must be stopped first/)).toBeTruthy();
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
  await user.click(screen.getByRole("button", { name: "30 minutes later" }));
  await screen.findByText("Response lost");
  await user.click(screen.getByRole("button", { name: "Tomorrow" }));
  await user.click(screen.getByRole("button", { name: "Move slot" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(move).toHaveBeenCalledTimes(2);
  expect(move.mock.calls[0]?.[1]).not.toEqual(move.mock.calls[1]?.[1]);
  expect(move.mock.calls[0]?.[2]).toBe(move.mock.calls[1]?.[2]);
  expect(move.mock.calls[0]?.[3]).toBe(move.mock.calls[1]?.[3]);
});
