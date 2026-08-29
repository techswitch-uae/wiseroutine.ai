import { beforeEach, describe, expect, it } from "vitest";
import {
  armAlerts,
  countdown,
  dueAlerts,
  pauseAlerts,
  resetAnnounced,
  upNextOf,
} from "./alerts";
import type { TodaySlot } from "./api";

const AT = Date.UTC(2026, 7, 11, 9, 0);
const MIN = 60_000;

/** Ten minutes long unless told otherwise, wherever it starts - so moving a
 *  slot in a test does not silently turn it into a zero-length one. */
const slot = (over: Partial<TodaySlot> & { id: string }): TodaySlot => {
  const startsAt = over.startsAt ?? AT;
  return {
    title: "Shoulder stretch",
    kind: "recovery",
    status: "planned",
    isLocked: false,
    conflictEventId: null,
    ...over,
    startsAt,
    endsAt: over.endsAt ?? startsAt + 10 * MIN,
  };
};

beforeEach(resetAnnounced);

describe("dueAlerts", () => {
  it("carries the length of the slot, not the time it starts", () => {
    const [alert] = dueAlerts([slot({ id: "a" })], AT - MIN);
    expect(alert?.title).toBe("Shoulder stretch");
    expect(alert?.body).toBe("10 min. Starting now.");
  });

  it("leaves out anything already dealt with", () => {
    const day = [
      slot({ id: "done", status: "completed" }),
      slot({ id: "gone", status: "skipped" }),
      slot({ id: "left", status: "planned" }),
    ];
    expect(dueAlerts(day, AT - MIN).map((a) => a.slotId)).toEqual(["left"]);
  });

  it("still fires for a start missed by a moment, but not by an hour", () => {
    const day = [slot({ id: "just", startsAt: AT - 30_000 })];
    expect(dueAlerts(day, AT)).toHaveLength(1);
    expect(dueAlerts(day, AT + 60 * MIN)).toHaveLength(0);
  });

  it("comes due in order", () => {
    const day = [
      slot({ id: "late", startsAt: AT + 2 * MIN }),
      slot({ id: "soon", startsAt: AT + MIN }),
    ];
    expect(dueAlerts(day, AT).map((a) => a.slotId)).toEqual(["soon", "late"]);
  });
});

describe("upNextOf", () => {
  it("says nothing when the day has nothing left", () => {
    expect(upNextOf([slot({ id: "a", status: "completed" })], AT)).toEqual({});
  });

  it("counts down to the next one, and offers no way to start it early", () => {
    const next = upNextOf([slot({ id: "a", startsAt: AT + 18 * MIN })], AT);
    expect(next.badge).toBe("18m");
    // Name and length apart: the menu bar shows the name beside the icon and
    // the length only in the menu behind it.
    expect(next.title).toBe("Shoulder stretch");
    expect(next.label).toBe("10 min");
    expect(next.slotId).toBeUndefined();
  });

  it("offers a start once the slot is actually live", () => {
    const next = upNextOf([slot({ id: "a", startsAt: AT - MIN })], AT);
    expect(next.badge).toBe("now");
    expect(next.slotId).toBe("a");
  });

  it("skips a slot whose time has wholly passed", () => {
    const day = [
      slot({ id: "over", startsAt: AT - 30 * MIN, endsAt: AT - 20 * MIN }),
      slot({ id: "next", startsAt: AT + MIN, endsAt: AT + 11 * MIN }),
    ];
    expect(upNextOf(day, AT).title).toBe("Shoulder stretch");
    expect(upNextOf(day, AT).badge).toBe("1m");
  });
});

describe("countdown", () => {
  it("rounds up, so a slot 90 seconds out does not read as stuck on 1m", () => {
    expect(countdown(90_000)).toBe("2m");
  });

  it("pads the minutes past an hour, and names both units", () => {
    // "2h 05" is not a duration, it is two numbers - and the eye has to guess
    // which of them is which.
    expect(countdown(125 * MIN)).toBe("2h 05m");
  });

  it("never goes negative", () => {
    expect(countdown(-5 * MIN)).toBe("0m");
  });
});

describe("armAlerts", () => {
  // Outside Tauri there is nothing to arm, which is exactly the guard worth
  // pinning: the same bundle ships as the web app.
  it("is inert in a browser and hands back a disposer that is safe to call", () => {
    expect(() => armAlerts([slot({ id: "a" })], AT)()).not.toThrow();
  });
});

describe("pauseAlerts", () => {
  const day = [
    slot({ id: "quiet", startsAt: AT + 10 * MIN }),
    slot({ id: "loud", startsAt: AT + 90 * MIN }),
  ];

  it("silences a start inside the pause and leaves the one after it", () => {
    pauseAlerts(AT);
    expect(dueAlerts(day, AT).map((a) => a.slotId)).toEqual(["loud"]);
  });

  it("still says what is up next - the pause silences, it does not hide", () => {
    pauseAlerts(AT);
    expect(upNextOf(day, AT).title).toBe("Shoulder stretch");
  });

  it("wears off", () => {
    pauseAlerts(AT, 5 * MIN);
    expect(dueAlerts(day, AT).map((a) => a.slotId)).toEqual(["quiet", "loud"]);
  });
});
