import { beforeEach, describe, expect, it } from "vitest";
import type { TodayResponse } from "./api";
import { publishPlan, resetPlans, todaySnapshot } from "./plan-store";

/**
 * The two questions the store answers, which are not the same question.
 *
 * "What am I looking at" moves with the day view. "What is happening" does
 * not, and the menu bar and the notifications read the second one. Collapsing
 * them is what left the menu bar announcing a slot from twenty minutes ago the
 * moment anyone opened the week.
 */

/** Noon UTC on Tuesday 11 August 2026. */
const NOW = Date.UTC(2026, 7, 11, 12, 0);

const planFor = (
  year: number,
  month: number,
  day: number,
  timeZone = "UTC",
): TodayResponse =>
  ({
    date: { year, month, day },
    timeZone,
    // The *visible range*, not the whole day - which is exactly why the store
    // must not use these to decide what "today" is.
    dayStart: Date.UTC(year, month - 1, day, 8),
    dayEnd: Date.UTC(year, month - 1, day, 18),
    slots: [],
  }) as unknown as TodayResponse;

describe("which plan the menu bar reads", () => {
  beforeEach(() => resetPlans());

  it("keeps today's plan when the day view pages forward", () => {
    publishPlan(planFor(2026, 8, 11), NOW);
    expect(todaySnapshot()?.date.day).toBe(11);

    // Someone opens next Tuesday. The page follows; the menu bar must not.
    publishPlan(planFor(2026, 8, 18), NOW);
    expect(todaySnapshot()?.date.day).toBe(11);
  });

  it("keeps today's plan when the page publishes nothing at all", () => {
    publishPlan(planFor(2026, 8, 11), NOW);
    // Leaving Today for the week view unmounts the page behind the plan.
    publishPlan(null, NOW);
    expect(todaySnapshot()?.date.day).toBe(11);
  });

  it("takes a fresh plan for today over the one it was holding", () => {
    publishPlan(planFor(2026, 8, 11), NOW);
    const replanned = planFor(2026, 8, 11);
    publishPlan(replanned, NOW);
    expect(todaySnapshot()).toBe(replanned);
  });

  it("judges by date, not by the hours on screen", () => {
    // Nine in the evening: past the visible range's end, still today. A bounds
    // test would call this stale at exactly the hour someone most wants to
    // know what is left.
    const evening = Date.UTC(2026, 7, 11, 21, 0);
    publishPlan(planFor(2026, 8, 11), evening);
    expect(todaySnapshot()?.date.day).toBe(11);
  });

  it("reads the date in the account's zone, not the machine's", () => {
    // 23:00 UTC on the 11th is already the 12th in Sydney, so a Sydney account
    // whose plan says the 12th is looking at today.
    const late = Date.UTC(2026, 7, 11, 23, 0);
    publishPlan(planFor(2026, 8, 12, "Australia/Sydney"), late);
    expect(todaySnapshot()?.date.day).toBe(12);
  });
});

/**
 * A day ends, and the menu bar has to notice.
 *
 * Held with no expiry, the plan that *was* today went on being today's plan
 * after midnight - so the tray kept naming a slot from a day that had already
 * finished, over a new day whose slots had not been placed yet.
 */
describe("when today stops being today", () => {
  beforeEach(() => resetPlans());

  it("lets go of yesterday's plan rather than reporting it", () => {
    publishPlan(planFor(2026, 8, 11), NOW);
    expect(todaySnapshot()?.date.day).toBe(11);

    // The next morning, before anything has been fetched for it.
    publishPlan(null, Date.UTC(2026, 7, 12, 9, 0));
    expect(todaySnapshot()).toBeNull();
  });

  it("takes the new day as soon as one is loaded", () => {
    const morning = Date.UTC(2026, 7, 12, 9, 0);
    publishPlan(planFor(2026, 8, 11), NOW);
    publishPlan(planFor(2026, 8, 12), morning);
    expect(todaySnapshot()?.date.day).toBe(12);
  });
});
