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
/** Mid-block: after the start, before the end. What every case that is not
 *  about the clock should be read at. */
const DURING = AT + 60_000;
/** The next morning. The state a block is left in overnight is the whole
 *  reason `slotState` takes a clock at all. */
const TOMORROW = AT + 24 * 3_600_000;

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
    expect(slotState(slot(), AT - 60_000)).toMatchObject({
      startable: true,
      movable: true,
    });
  });

  it("says who pinned it when the user placed it", () => {
    expect(slotState(slot({ isLocked: true }), AT - 60_000).note).toContain(
      "You placed",
    );
    // Still movable: pinning is about the planner leaving it alone, not about
    // the user being unable to change their mind.
    expect(slotState(slot({ isLocked: true }), AT - 60_000).movable).toBe(true);
  });

  it("gives the two immovable states different reasons", () => {
    const running = slotState(slot({ status: "started" }), DURING);
    const done = slotState(slot({ status: "completed" }), DURING);

    expect(running.movable).toBe(false);
    expect(done.movable).toBe(false);
    expect(running.note).not.toBe(done.note);
    expect(running.note).toContain("Running now");
    expect(done.note).toContain("Done");
  });

  // The whole point of a stop being a skip rather than a completion: it can be
  // picked back up, and it must never be offered as something that happened.
  it("lets a stopped block be picked back up", () => {
    const stopped = slotState(slot({ status: "skipped" }), DURING);
    expect(stopped.startable).toBe(true);
    expect(stopped.running).toBe(false);
  });

  it("offers nothing to do to one that was missed", () => {
    expect(slotState(slot({ status: "missed" }), DURING)).toMatchObject({
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
      expect(slotState(slot({ status }), DURING).running).toBe(false);
    }
    expect(slotState(slot({ status: "started" }), DURING).running).toBe(true);
  });
});

/**
 * What the clock decides, which the status alone cannot.
 *
 * Every one of these read the same before `slotState` took a `now`: a block
 * started yesterday still said "Running now", and stopping it offered to
 * "resume it while its time is still running" about a window that closed
 * sixteen hours earlier. A status says what happened; only the clock says
 * whether anything can still be done about it.
 */
describe("a block whose time has passed", () => {
  it("is not running, however long it has said it was", () => {
    const stale = slotState(slot({ status: "started" }), TOMORROW);
    expect(stale.running).toBe(false);
    expect(stale.note).not.toContain("Running now");
  });

  it("asks what happened rather than offering to carry on", () => {
    const stale = slotState(slot({ status: "started" }), TOMORROW);
    expect(stale.unresolved).toBe(true);
    expect(stale.startable).toBe(false);
  });

  it("never offers to resume a stopped block into a day that has gone", () => {
    const stale = slotState(slot({ status: "skipped" }), TOMORROW);
    expect(stale.startable).toBe(false);
    expect(stale.note).not.toContain("still running");
  });

  it("does not offer to start something that would begin in the past", () => {
    const stale = slotState(slot({ status: "planned" }), TOMORROW);
    expect(stale.startable).toBe(false);
    expect(stale.movable).toBe(false);
  });

  it("holds the line exactly at the end, not a moment before", () => {
    // One millisecond inside its window is still a session someone is in.
    const inside = slotState(slot({ status: "started" }), AT + 5 * 60_000 - 1);
    expect(inside.running).toBe(true);
    expect(inside.unresolved).toBe(false);

    const outside = slotState(slot({ status: "started" }), AT + 5 * 60_000);
    expect(outside.running).toBe(false);
    expect(outside.unresolved).toBe(true);
  });

  it("leaves a finished block finished, whenever it is read", () => {
    for (const status of ["completed", "missed"] as const) {
      const later = slotState(slot({ status }), TOMORROW);
      expect(later.unresolved).toBe(false);
      expect(later.startable).toBe(false);
    }
  });
});
