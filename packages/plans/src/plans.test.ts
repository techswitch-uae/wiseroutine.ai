import { describe, expect, test } from "vitest";
import { can, resolvePlan, visibleModules } from "./index";

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
      can("free", { kind: "dashboard.setModules", modules: ["up_next"] }).ok,
    ).toBe(true);
    expect(
      can("free", { kind: "dashboard.setModules", modules: ["sitting_streak"] })
        .ok,
    ).toBe(false);
    expect(
      can("pro", { kind: "dashboard.setModules", modules: ["sitting_streak"] })
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

describe("visibleModules", () => {
  test("a downgraded user keeps only what free allows", () => {
    expect(
      visibleModules("free", ["up_next", "sitting_streak", "today_so_far"]),
    ).toEqual(["up_next", "today_so_far"]);
  });

  test("up_next is always present even if not chosen", () => {
    expect(visibleModules("free", ["today_so_far"])).toContain("up_next");
  });
});
