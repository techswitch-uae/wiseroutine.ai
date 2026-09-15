import { expect, test } from "vitest";
import { graceAction } from "./grace";

const startsAt = 1_700_000_000_000;
const endsAt = startsAt + 600_000;
const slot = { status: "planned", startsAt, endsAt, startPolicy: "manual" };

test.each(["manual", "prompt", "unknown"])("%s never auto-moves or invents an outcome", (startPolicy) => {
  for (const now of [startsAt - 1, startsAt, startsAt + 120_000, startsAt + 180_000, endsAt, endsAt + 86_400_000])
    expect(graceAction({ ...slot, startPolicy }, now)).toBe("leave");
});

test.each(["planned", "live"])("guided %s starts only while time remains, including a late sweep", (status) => {
  const auto = { ...slot, status, startPolicy: "auto" };
  expect(graceAction(auto, startsAt - 1)).toBe("leave");
  for (const now of [startsAt, startsAt + 120_000, endsAt - 1])
    expect(graceAction(auto, now)).toBe("start");
  for (const now of [endsAt, endsAt + 86_400_000])
    expect(graceAction(auto, now)).toBe("leave");
});

test.each(["started", "skipped", "missed", "completed", "cancelled", "bucketed"])("%s never auto-starts", (status) => {
  expect(graceAction({ ...slot, status, startPolicy: "auto" }, startsAt)).toBe("leave");
});
