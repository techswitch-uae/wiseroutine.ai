import { describe, expect, test } from "vitest";
import { can, resolvePlan, visibleWidgets } from "./index";

describe("can", () => {
  test("free stops at two active activities, pro does not", () => {
    expect(can("free", { kind: "activity.create", activeCount: 1 }).ok).toBe(
      true,
    );
    expect(can("free", { kind: "activity.create", activeCount: 2 }).ok).toBe(
      false,
    );
    expect(can("pro", { kind: "activity.create", activeCount: 99 }).ok).toBe(
      true,
    );
  });

  test("adaptive replanning and ranked rearrange are pro only", () => {
    expect(can("free", { kind: "plan.adaptive" }).ok).toBe(false);
    expect(can("free", { kind: "plan.rearrange" }).ok).toBe(false);
    expect(can("pro", { kind: "plan.adaptive" }).ok).toBe(true);
    expect(can("pro", { kind: "plan.rearrange" }).ok).toBe(true);
  });

  test("a denial explains itself and offers a way out", () => {
    const decision = can("free", { kind: "activity.create", activeCount: 2 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain("2");
      expect(decision.upsell).toMatch(/pause|Upgrade/i);
    }
  });

  test("free may only pick from the default module set", () => {
    expect(
      can("free", { kind: "dashboard.setWidgets", widgets: ["up_next"] }).ok,
    ).toBe(true);
    expect(
      can("free", { kind: "dashboard.setWidgets", widgets: ["sitting_streak"] })
        .ok,
    ).toBe(false);
    expect(
      can("pro", { kind: "dashboard.setWidgets", widgets: ["sitting_streak"] })
        .ok,
    ).toBe(true);
  });
});

describe("resolvePlan", () => {
  const now = 1_000_000;

  test("a beta grant outranks having no subscription", () => {
    expect(resolvePlan({ grant: { plan: "pro" } }, now)).toEqual({
      plan: "pro",
      source: "grant",
    });
  });

  test("an expired grant falls through", () => {
    expect(
      resolvePlan({ grant: { plan: "pro", expiresAt: now - 1 } }, now).plan,
    ).toBe("free");
  });

  test("an active subscription gives pro", () => {
    expect(
      resolvePlan({ subscription: { status: "active" } }, now).source,
    ).toBe("stripe");
  });

  test("past_due keeps access - dunning is not a hard cutoff", () => {
    expect(
      resolvePlan({ subscription: { status: "past_due" } }, now).plan,
    ).toBe("pro");
  });

  test("a cancelled subscription drops to free", () => {
    expect(
      resolvePlan({ subscription: { status: "canceled" } }, now).plan,
    ).toBe("free");
  });

  test("no grant and no subscription is free", () => {
    expect(resolvePlan({}, now)).toEqual({ plan: "free", source: "default" });
  });
});

describe("the trial, as a grant", () => {
  const now = 1_000_000;
  const DAY = 86_400_000;

  // What every signup gets: fourteen days of pro with no card, issued as a
  // grant because a trial you have to enter card details for is not the offer
  // the pricing page makes.
  test("runs pro for as long as it lasts", () => {
    const state = resolvePlan(
      { grant: { plan: "pro", expiresAt: now + 14 * DAY } },
      now,
    );
    expect(state).toEqual({
      plan: "pro",
      source: "grant",
      expiresAt: now + 14 * DAY,
    });
  });

  // The whole reason there is no "beta over" switch: the fourteenth day
  // passing is the switch.
  test("drops to free when it runs out, with nothing to flip", () => {
    expect(
      resolvePlan({ grant: { plan: "pro", expiresAt: now - 1 } }, now).plan,
    ).toBe("free");
  });

  // Someone who subscribes during the trial must not be downgraded when it
  // ends. The grant expires, the subscription is still there, and resolution
  // falls through to it.
  test("expiring does not take paid access with it", () => {
    const state = resolvePlan(
      {
        grant: { plan: "pro", expiresAt: now - 1 },
        subscription: { status: "active" },
      },
      now,
    );
    expect(state).toEqual({ plan: "pro", source: "stripe" });
  });

  // Founding access is the same row with a longer expiry - see the grant
  // script. Nothing in resolution knows the difference, which is the point.
  test("founding access is a trial with a further date on it", () => {
    const state = resolvePlan(
      { grant: { plan: "pro", expiresAt: now + 365 * DAY } },
      now,
    );
    expect(state.source).toBe("grant");
    expect(state.expiresAt).toBe(now + 365 * DAY);
  });
});

describe("visibleWidgets", () => {
  test("a downgraded user keeps only what free allows", () => {
    expect(
      visibleWidgets("free", ["up_next", "sitting_streak", "today_so_far"]),
    ).toEqual(["up_next", "today_so_far"]);
  });

  test("up_next is always present even if not chosen", () => {
    expect(visibleWidgets("free", ["today_so_far"])).toContain("up_next");
  });

  /**
   * The user's order, not the constant's.
   *
   * This used to filter `ALL_WIDGETS` by membership, which returned that
   * constant's hard-coded order however the user had arranged theirs - so
   * `position` was written and never read, and dragging a widget did nothing.
   */
  test("keeps the order the user chose", () => {
    expect(
      visibleWidgets("pro", ["today_so_far", "sitting_streak", "up_next"]),
    ).toEqual(["today_so_far", "sitting_streak", "up_next"]);
  });

  // Pinned means "always present", not "always first" - a user who has put
  // Up next third is not overruled.
  test("a pinned widget the user placed keeps its place", () => {
    expect(visibleWidgets("pro", ["missed_today", "up_next"])).toEqual([
      "missed_today",
      "up_next",
    ]);
  });

  // Nowhere else to put it: it cannot be turned off, and the saved list does
  // not say where it goes.
  test("a pinned widget the user never chose goes first", () => {
    expect(visibleWidgets("pro", ["missed_today"])).toEqual([
      "up_next",
      "missed_today",
    ]);
  });

  /**
   * An addon's widget is not in `ALL_WIDGETS` and never will be, so the plan
   * cannot gate it by name. Whether the addon is installed is the caller's
   * question - this package has no database.
   */
  test("a widget belonging to an addon passes through", () => {
    expect(
      visibleWidgets("free", ["up_next", "acme.fitness/next-workout"]),
    ).toEqual(["up_next", "acme.fitness/next-workout"]);
  });

  test("an unknown first-party key is dropped", () => {
    expect(visibleWidgets("free", ["up_next", "astrology"])).toEqual([
      "up_next",
    ]);
  });
});
