import { describe, expect, it } from "vitest";
import type { TodaySlot } from "./api";
import { slotState } from "./slot-state";

const AT = Date.UTC(2026, 7, 11, 9);
const END = AT + 5 * 60_000;
const slot = (over: Partial<TodaySlot> = {}): TodaySlot => ({
  id: "s1",
  title: "Eye rest",
  kind: "recovery",
  startsAt: AT,
  endsAt: END,
  status: "planned",
  isLocked: false,
  conflictEventId: null,
  ...over,
});

describe("slotState", () => {
  it("leaves ordinary planned slots quiet, with their controls available", () => {
    for (const now of [AT - 60_000, AT, AT + 120_000 - 1]) {
      expect(slotState(slot(), now)).toEqual({
        label: null,
        startable: true,
        running: false,
        movable: true,
        unresolved: false,
      });
    }
  });

  it.each(["planned", "live"] as const)(
    "%s keeps first Start after movement expires, without claiming time has passed",
    (status) => {
      for (const now of [AT + 120_000, END - 1])
        expect(slotState(slot({ status }), now)).toMatchObject({
          label: null,
          startable: true,
          movable: false,
        });
    },
  );

  it("identifies user placement without explaining the scheduler", () => {
    expect(slotState(slot({ isLocked: true }), AT)).toMatchObject({
      label: "Placed by you",
      movable: true,
      startable: true,
    });
  });

  it("separates due from actually started, including an early start", () => {
    expect(slotState(slot({ status: "live" }), AT).running).toBe(false);
    for (const now of [AT - 60_000, AT, END - 1]) {
      expect(slotState(slot({ status: "started" }), now)).toMatchObject({
        label: "Running",
        running: true,
        startable: false,
        movable: false,
        unresolved: false,
      });
    }
  });

  it("keeps Done as an accessible name for the completion cue", () => {
    expect(slotState(slot({ status: "completed" }), AT)).toEqual({
      label: "Done",
      running: false,
      startable: false,
      movable: false,
      unresolved: false,
    });
  });

  it("offers resume only before the scheduled start cutoff", () => {
    expect(
      slotState(slot({ status: "skipped" }), AT + 120_000 - 1),
    ).toMatchObject({
      label: "Stopped",
      startable: true,
      running: false,
      movable: true,
    });
    expect(slotState(slot({ status: "skipped" }), AT + 120_000)).toMatchObject({
      startable: false,
      movable: false,
    });
  });

  it("asks for the outcome at the end without guessing why it was not recorded", () => {
    for (const now of [END, AT + 24 * 3_600_000]) {
      expect(slotState(slot({ status: "started" }), now)).toEqual({
        label: "Needs confirmation",
        running: false,
        startable: false,
        movable: false,
        unresolved: true,
      });
    }
  });

  it.each(["planned", "live"] as const)(
    "elapsed unstarted %s work can neither move nor start",
    (status) => {
      expect(slotState(slot({ status }), END)).toMatchObject({
        label: "Time passed",
        startable: false,
        movable: false,
        running: false,
      });
    },
  );

  it("keeps elapsed stopped and missed work in history, without a new appointment", () => {
    for (const status of ["skipped", "missed"] as const)
      expect(slotState(slot({ status }), END)).toMatchObject({
        movable: false,
        running: false,
        startable: false,
      });
  });

  it.each(["completed", "cancelled", "bucketed"] as const)(
    "never starts or moves %s work, regardless of the clock",
    (status) => {
      for (const now of [AT - 60_000, AT, END, AT + 24 * 3_600_000]) {
        expect(slotState(slot({ status }), now)).toMatchObject({
          startable: false,
          running: false,
          movable: false,
          unresolved: false,
        });
      }
    },
  );
});
