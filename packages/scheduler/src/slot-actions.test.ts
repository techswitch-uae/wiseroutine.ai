import { expect, test } from "vitest";
import { canPostponeSlot, canStopSlot, slotStopDeadline } from "./slot-actions";

const AT = 1_700_000_000_000;
const slot = (minutes: number, startedAt = AT) => ({
  status: "started",
  startsAt: AT,
  endsAt: AT + minutes * 60_000,
  startedAt,
});

test.each([1, 2, 3, 4, 10, 60])(
  "a %i-minute slot stops strictly before half its duration or two minutes",
  (minutes) => {
    const s = slot(minutes);
    const deadline = AT + Math.min(minutes * 30_000, 120_000);
    expect(slotStopDeadline(s)).toBe(deadline);
    expect(canStopSlot(s, deadline - 1)).toBe(true);
    expect(canStopSlot(s, deadline)).toBe(false);
    expect(canStopSlot(s, deadline + 1)).toBe(false);
    expect(canStopSlot(s, AT - 1)).toBe(false);
  },
);

test("early and late starts use the actual press, capped at the slot end", () => {
  expect(slotStopDeadline(slot(3, AT - 600_000))).toBe(AT - 510_000);
  expect(slotStopDeadline(slot(10, AT + 300_000))).toBe(AT + 420_000);
  expect(slotStopDeadline(slot(10, AT + 590_000))).toBe(AT + 600_000);
});

test("missing start evidence and invalid durations never grant a stop window", () => {
  for (const s of [
    { ...slot(5), startedAt: null },
    { ...slot(5), startedAt: undefined },
    { ...slot(5), startedAt: Number.NaN },
    slot(0),
    slot(-1),
  ])
    expect(canStopSlot(s, AT)).toBe(false);
});

test.each([
  "planned",
  "live",
  "started",
  "skipped",
  "missed",
  "bucketed",
  "completed",
  "cancelled",
])("%s has explicit postpone/stop rules", (status) => {
  const s = { ...slot(10), status };
  expect(canPostponeSlot(s)).toBe(
    ["planned", "live", "skipped", "missed", "bucketed"].includes(status),
  );
  expect(canStopSlot(s, AT)).toBe(status === "started");
});
