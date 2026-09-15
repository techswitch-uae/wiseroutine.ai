import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { armAlerts, countdown, trayEntries, upNextOf } from "./alerts";
import type { TodayMeeting, TodaySlot } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

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

  it("keeps Start after the movement cutoff, withdrawing it at the slot end", () => {
    const current = slot({ id: "a" });
    const day = [current];
    expect(upNextOf(day, AT + 120_000).slotId).toBe("a");
    expect(upNextOf(day, current.endsAt - 1).slotId).toBe("a");
    expect(upNextOf(day, current.endsAt)).toEqual({});
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

const meeting = (over: Partial<TodayMeeting> = {}): TodayMeeting => ({
  id: "meeting",
  title: "Design review",
  startsAt: AT,
  endsAt: AT + 60 * MIN,
  isAllDay: false,
  provider: "microsoft",
  ...over,
});

describe("trayEntries", () => {
  it("includes timed imports with an explicit read-only kind, not all-day events or settled slots", () => {
    expect(
      trayEntries(
        [slot({ id: "a" }), slot({ id: "done", status: "completed" })],
        [meeting(), meeting({ id: "all-day", isAllDay: true })],
      ),
    ).toEqual([
      {
        id: "a",
        title: "Shoulder stretch",
        startsAt: AT,
        endsAt: AT + 10 * MIN,
        kind: "slot",
      },
      {
        id: "meeting",
        title: "Design review",
        startsAt: AT,
        endsAt: AT + 60 * MIN,
        kind: "meeting",
      },
    ]);
  });
  it("uses Busy for a redacted meeting, without inventing an activity", () => {
    expect(trayEntries([], [meeting({ title: null })])[0]).toMatchObject({
      title: "Busy",
      kind: "meeting",
    });
  });
});

describe("armAlerts", () => {
  // Outside Tauri there is nothing to arm, which is exactly the guard worth
  // pinning: the same bundle ships as the web app, where there is no menu bar
  // and no notifications to push a schedule to.
  it("is inert in a browser", () => {
    expect(() => armAlerts([slot({ id: "a" })], [meeting()])).not.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("sends both kinds through the native bridge and clears imported titles on refresh", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    armAlerts([slot({ id: "a" })], [meeting()]);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_schedule", {
        entries: trayEntries([slot({ id: "a" })], [meeting()]),
      }),
    );
    armAlerts([], [meeting({ title: null })]);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_schedule", {
        entries: trayEntries([], [meeting({ title: null })]),
      }),
    );
    armAlerts([]);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_schedule", { entries: [] }),
    );
  });
});
