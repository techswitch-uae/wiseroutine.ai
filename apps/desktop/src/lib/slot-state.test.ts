import { describe, expect, it } from "vitest";
import type { TodaySlot } from "./api";
import { slotState } from "./slot-state";

/**
 * Every state owes a reason.
 *
 * "Locked" on its own is the kind of word an app uses when it does not want to
 * explain itself, so the test that matters here is not which booleans come
 * back - it is that each state says *why* it is what it is, and that the two
 * reasons a block cannot be moved stay distinct: one is happening, the other
 * already happened.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

const slot = (over: Partial<TodaySlot> = {}): TodaySlot => ({
  id: "s1",
  title: "Eye rest",
  kind: "recovery",
  startsAt: AT,
  endsAt: AT + 5 * 60_000,
  status: "planned",
  isLocked: false,
  conflictEventId: null,
  ...over,
});

describe("slotState", () => {
  it("offers a nudge and a start to a block still ahead of you", () => {
    expect(slotState(slot())).toMatchObject({ startable: true, movable: true });
  });

  it("says who pinned it when the user placed it", () => {
    expect(slotState(slot({ isLocked: true })).note).toContain("You placed");
    // Still movable: pinning is about the planner leaving it alone, not about
    // the user being unable to change their mind.
    expect(slotState(slot({ isLocked: true })).movable).toBe(true);
  });

  it("gives the two immovable states different reasons", () => {
    const running = slotState(slot({ status: "started" }));
    const done = slotState(slot({ status: "completed" }));

    expect(running.movable).toBe(false);
    expect(done.movable).toBe(false);
    expect(running.note).not.toBe(done.note);
    expect(running.note).toContain("Running now");
    expect(done.note).toContain("Done");
  });

  // The whole point of a stop being a skip rather than a completion: it can be
  // picked back up, and it must never be offered as something that happened.
  it("lets a stopped block be picked back up", () => {
    const stopped = slotState(slot({ status: "skipped" }));
    expect(stopped.startable).toBe(true);
    expect(stopped.running).toBe(false);
  });

  it("offers nothing to do to one that was missed", () => {
    expect(slotState(slot({ status: "missed" }))).toMatchObject({
      startable: false,
      running: false,
      movable: false,
    });
  });

  it("only calls a block running while it is", () => {
    for (const status of [
      "planned",
      "completed",
      "skipped",
      "missed",
    ] as const) {
      expect(slotState(slot({ status })).running).toBe(false);
    }
    expect(slotState(slot({ status: "started" })).running).toBe(true);
  });
});
