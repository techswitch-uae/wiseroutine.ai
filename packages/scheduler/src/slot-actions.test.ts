import { expect, test } from "vitest";
import {
  canPostponeSlot,
  canStartSlot,
  canStopSlot,
  slotActionDeadline,
  slotStopDeadline,
} from "./slot-actions";

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
  expect(canPostponeSlot(s, AT)).toBe(
    ["planned", "live", "skipped", "bucketed"].includes(status),
  );
  expect(canStopSlot(s, AT)).toBe(status === "started");
});

test.each([1, 2, 3, 10])(
  "Start lasts until the end; Resume and movement keep the cutoff for a %i-minute slot",
  (minutes) => {
    for (const status of ["planned", "live", "skipped"]) {
      const s = { ...slot(minutes, AT - 600_000), status };
      const deadline = AT + Math.min(minutes * 60_000, 120_000);
      expect(slotActionDeadline(s)).toBe(deadline);
      for (const now of [AT - 3_600_000, AT, deadline - 1]) {
        expect(canStartSlot(s, now)).toBe(true);
        expect(canPostponeSlot(s, now)).toBe(true);
      }
      for (const now of [deadline, deadline + 1, s.endsAt, AT + 86_400_000]) {
        expect(canStartSlot(s, now)).toBe(status !== "skipped" && now < s.endsAt);
        expect(canPostponeSlot(s, now)).toBe(false);
      }
    }
  },
);

test("Not placed has no scheduled cutoff, while final history never moves or starts", () => {
  for (const now of [AT - 600_000, AT, AT + 86_400_000]) {
    for (const status of [
      "started",
      "missed",
      "completed",
      "cancelled",
      "bucketed",
    ]) {
      const s = { ...slot(10), status };
      expect(canStartSlot(s, now)).toBe(false);
      expect(canPostponeSlot(s, now)).toBe(status === "bucketed");
    }
  }
});

test("invalid appointment bounds cannot grant action permissions", () => {
  for (const s of [
    slot(0),
    slot(-1),
    { ...slot(10), startsAt: NaN },
    { ...slot(10), endsAt: Infinity },
  ]) {
    expect(slotActionDeadline(s)).toBeNull();
    expect(canStartSlot({ ...s, status: "planned" }, AT)).toBe(false);
    expect(canPostponeSlot({ ...s, status: "skipped" }, AT)).toBe(false);
  }
});
