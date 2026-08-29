import { describe, expect, test } from "vitest";
import { type GraceInput, graceAction } from "./grace";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

const slot = (over: Partial<GraceInput> = {}): GraceInput => ({
  startsAt: NOW,
  startPolicy: "manual",
  graceMinutes: 3,
  isLocked: false,
  autoMoveCount: 0,
  ...over,
});

describe("auto", () => {
  test("starts itself the moment it comes due", () => {
    expect(graceAction(slot({ startPolicy: "auto" }), NOW)).toBe("start");
  });

  // The one case the lock must not win. An eye rest placed by hand still has
  // to start on its own; what the lock protects is its *time*, not its press.
  test("starts itself even when the user placed it", () => {
    expect(
      graceAction(slot({ startPolicy: "auto", isLocked: true }), NOW),
    ).toBe("start");
  });

  // Grace is how long to wait for a press. There is no press.
  test("does not wait out a grace period first", () => {
    expect(
      graceAction(slot({ startPolicy: "auto", graceMinutes: 10 }), NOW),
    ).toBe("start");
  });

  test("is never moved, however many times the day has shifted", () => {
    expect(
      graceAction(slot({ startPolicy: "auto", autoMoveCount: 5 }), NOW),
    ).toBe("start");
  });
});

describe("manual", () => {
  test("is left alone inside its grace period", () => {
    expect(graceAction(slot(), NOW + 2 * MINUTE)).toBe("leave");
  });

  // The bug this was written for: the sweep used to move a slot the instant it
  // came due, so "moves itself in 3 min if you don't start" meant no minutes
  // at all and `graceMinutes` was never read.
  test("moves once its own grace has run out, not before", () => {
    expect(graceAction(slot(), NOW + 3 * MINUTE)).toBe("move");
  });

  test("uses the activity's number rather than one for everyone", () => {
    const patient = slot({ graceMinutes: 10 });
    expect(graceAction(patient, NOW + 5 * MINUTE)).toBe("leave");
    expect(graceAction(patient, NOW + 10 * MINUTE)).toBe("move");
  });

  test("with no grace at all, moves as soon as it is due", () => {
    expect(graceAction(slot({ graceMinutes: 0 }), NOW)).toBe("move");
  });

  test("gives up rather than moving a third time", () => {
    expect(graceAction(slot({ autoMoveCount: 2 }), NOW + 3 * MINUTE)).toBe(
      "miss",
    );
  });

  // Order matters: the cap must not turn a slot inside its grace into a miss.
  test("is not marked missed while it is still within its grace", () => {
    expect(graceAction(slot({ autoMoveCount: 2 }), NOW + MINUTE)).toBe("leave");
  });
});

describe("a slot the user placed", () => {
  // The free plan's promise, and the reason the query stopped filtering locked
  // slots out: they have to be reached, then left.
  test("stays where it was put, however late it gets", () => {
    expect(graceAction(slot({ isLocked: true }), NOW + 60 * MINUTE)).toBe(
      "leave",
    );
  });

  test("is never marked missed by the mover either", () => {
    expect(
      graceAction(
        slot({ isLocked: true, autoMoveCount: 2 }),
        NOW + 60 * MINUTE,
      ),
    ).toBe("leave");
  });
});

describe("prompt", () => {
  // The difference from `manual` is that a notification went out, which is the
  // client's job. What happens when it is ignored is the same.
  test("waits out its grace, then moves like a manual slot", () => {
    const asked = slot({ startPolicy: "prompt" });
    expect(graceAction(asked, NOW + MINUTE)).toBe("leave");
    expect(graceAction(asked, NOW + 3 * MINUTE)).toBe("move");
  });
});

describe("an unknown policy", () => {
  // A column is a string, and a future version of the app writing a policy
  // this one has never heard of must not make slots vanish or start
  // themselves. Falling back to manual is the conservative answer.
  test("behaves like manual rather than doing something surprising", () => {
    expect(graceAction(slot({ startPolicy: "telepathy" }), NOW)).toBe("leave");
    expect(
      graceAction(slot({ startPolicy: "telepathy" }), NOW + 3 * MINUTE),
    ).toBe("move");
  });
});
