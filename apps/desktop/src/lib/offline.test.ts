import { beforeEach, describe, expect, test } from "vitest";
import type { TodayResponse, TodaySlot } from "./api";
import {
  cachedPlan,
  cachePlan,
  clearOfflineState,
  enqueue,
  forget,
  pending,
  withPending,
} from "./offline";

const HOUR = 3_600_000;
const NOON = 1_700_000_000_000;

const slot = (id: string, over: Partial<TodaySlot> = {}): TodaySlot => ({
  id,
  title: "Focus",
  kind: "focus",
  startsAt: NOON,
  endsAt: NOON + HOUR,
  status: "planned",
  isLocked: false,
  conflictEventId: null,
  ...over,
});

const plan = (over: Partial<TodayResponse> = {}): TodayResponse => ({
  date: { year: 2023, month: 11, day: 14 },
  timeZone: "Europe/Rome",
  dayStart: NOON - 4 * HOUR,
  dayEnd: NOON + 6 * HOUR,
  slots: [slot("a"), slot("b")],
  meetings: [],
  modules: [],
  ...over,
});

beforeEach(clearOfflineState);

describe("cachedPlan", () => {
  test("a plan saved for today comes back", () => {
    cachePlan(plan(), NOON);
    expect(cachedPlan(NOON)?.data.slots).toHaveLength(2);
    expect(cachedPlan(NOON)?.cachedAt).toBe(NOON);
  });

  /**
   * The case that makes this worth a check: yesterday's plan is worse than no
   * plan. Every time on it has passed, and its slot ids no longer exist - so
   * following it would mean ticking off things that are gone.
   */
  test("a plan whose day has ended is refused", () => {
    cachePlan(plan(), NOON);
    expect(cachedPlan(NOON + 7 * HOUR)).toBeNull();
  });

  test("a plan for a day that has not started is refused", () => {
    cachePlan(plan(), NOON);
    expect(cachedPlan(NOON - 5 * HOUR)).toBeNull();
  });

  test("nothing saved is null, not a throw", () => {
    expect(cachedPlan(NOON)).toBeNull();
  });

  test("a corrupt entry is discarded rather than crashing the view", () => {
    globalThis.localStorage.setItem("wiseroutine.today", "{not json");
    expect(cachedPlan(NOON)).toBeNull();
  });
});

describe("the queue", () => {
  test("actions come back in the order they were taken", () => {
    enqueue({ slotId: "a", kind: "start", at: NOON });
    enqueue({ slotId: "a", kind: "complete", at: NOON + 60_000 });

    expect(pending().map((x) => x.kind)).toEqual(["start", "complete"]);
  });

  test("only the sent ones are forgotten", () => {
    const first = enqueue({ slotId: "a", kind: "start", at: NOON });
    enqueue({ slotId: "b", kind: "skip", at: NOON });

    forget([first.id]);
    expect(pending().map((x) => x.slotId)).toEqual(["b"]);
  });

  test("signing out drops the plan and the queue together", () => {
    cachePlan(plan(), NOON);
    enqueue({ slotId: "a", kind: "start", at: NOON });

    clearOfflineState();
    expect(cachedPlan(NOON)).toBeNull();
    expect(pending()).toEqual([]);
  });
});

describe("withPending", () => {
  // Without this a slot ticked off offline springs back to "planned" on the
  // next render, which reads as the app having lost the action.
  test("a queued action shows on the slot", () => {
    const result = withPending(plan(), [
      { id: "1", slotId: "a", kind: "complete", at: NOON },
    ]);

    expect(result.slots[0]?.status).toBe("completed");
    expect(result.slots[1]?.status).toBe("planned");
  });

  test("the last action on a slot wins", () => {
    const result = withPending(plan(), [
      { id: "1", slotId: "a", kind: "start", at: NOON },
      { id: "2", slotId: "a", kind: "complete", at: NOON + 60_000 },
    ]);

    expect(result.slots[0]?.status).toBe("completed");
  });

  test("nothing queued returns the plan untouched", () => {
    const original = plan();
    expect(withPending(original, [])).toBe(original);
  });

  test("the cached plan is not mutated", () => {
    const original = plan();
    withPending(original, [{ id: "1", slotId: "a", kind: "skip", at: NOON }]);
    expect(original.slots[0]?.status).toBe("planned");
  });
});
