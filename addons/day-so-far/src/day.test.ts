import type { DaySlot } from "@wiseroutine/addon-sdk";
import { describe, expect, it } from "vitest";
import {
  clockOf,
  footnoteOf,
  headlineOf,
  settledOf,
  spanOf,
  tallyOf,
  totalOf,
} from "./day";

/**
 * The rules the card is drawn from.
 *
 * These moved out of the app when the card became an addon, so this file is
 * also the check that nothing was lost in the move: the app's own tests
 * asserted these through the rendered card, and asserting them directly is the
 * better test anyway - they are rules about counting, and they were being
 * checked by reading a sentence off a screen.
 */

const NOON = Date.UTC(2026, 8, 1, 12, 0);
const MINUTE = 60_000;

const slot = (over: Partial<DaySlot> = {}): DaySlot => ({
  id: "s",
  title: "Stretch",
  kind: "recovery",
  startsAt: NOON,
  endsAt: NOON + 30 * MINUTE,
  status: "planned",
  ownedByYou: false,
  ...over,
});

describe("tallyOf", () => {
  it("counts a completed block, and its minutes", () => {
    const t = tallyOf([slot({ status: "completed" })], NOON);
    expect(t.done).toBe(1);
    expect(t.doneMinutes).toBe(30);
  });

  /**
   * The distinction the whole tally exists for. A planned block whose window
   * closed while nobody was looking is not time still ahead of you - counting
   * its minutes as "to go" makes the rest of the day look longer than it is.
   */
  it("separates a block still ahead from one whose window has closed", () => {
    const t = tallyOf(
      [
        slot({
          id: "later",
          startsAt: NOON + MINUTE,
          endsAt: NOON + 20 * MINUTE,
        }),
        slot({
          id: "lapsed",
          startsAt: NOON - 60 * MINUTE,
          endsAt: NOON - MINUTE,
        }),
      ],
      NOON,
    );
    expect(t.ahead).toBe(1);
    expect(t.overdue).toBe(1);
    expect(t.aheadMinutes).toBe(19);
  });

  /** A block you are in the middle of is allowed to run past its own end. */
  it("keeps a started block ahead even once its end has passed", () => {
    const t = tallyOf(
      [slot({ status: "started", endsAt: NOON - MINUTE })],
      NOON,
    );
    expect(t.ahead).toBe(1);
    expect(t.overdue).toBe(0);
  });

  it("leaves a cancelled block out of the day entirely", () => {
    // A block taken off the day was never something the day failed to do, so
    // it must not appear in the total either.
    const t = tallyOf([slot({ status: "cancelled" })], NOON);
    expect(totalOf(t)).toBe(0);
  });

  it("names skipped and missed apart", () => {
    const t = tallyOf(
      [
        slot({ id: "a", status: "skipped" }),
        slot({ id: "b", status: "missed" }),
      ],
      NOON,
    );
    expect(t.skipped).toBe(1);
    expect(t.missed).toBe(1);
  });

  it("reports when the last block still ahead finishes", () => {
    const t = tallyOf(
      [
        slot({ id: "a", endsAt: NOON + 10 * MINUTE }),
        slot({ id: "b", endsAt: NOON + 90 * MINUTE }),
      ],
      NOON,
    );
    expect(t.endsAt).toBe(NOON + 90 * MINUTE);
  });
});

describe("settledOf", () => {
  it("is not settled while a block is unresolved but past", () => {
    // Overdue is the case worth pinning. A day whose last block quietly lapsed
    // is not a day that is done - it is a day still waiting on an answer.
    const t = tallyOf([slot({ endsAt: NOON - MINUTE })], NOON);
    expect(settledOf(t)).toBe(false);
  });

  it("is settled once everything has an answer", () => {
    const t = tallyOf([slot({ status: "completed" })], NOON);
    expect(settledOf(t)).toBe(true);
  });
});

describe("headlineOf", () => {
  it("says so when nothing was left undone", () => {
    const t = tallyOf(
      [
        slot({ id: "a", status: "completed" }),
        slot({ id: "b", status: "completed" }),
      ],
      NOON,
    );
    expect(headlineOf(t)).toBe("Everything you planned happened");
  });

  /** A skipped block means the day was not what was planned, even with
   *  nothing left to do. */
  it("counts rather than congratulates when something lapsed", () => {
    const t = tallyOf(
      [
        slot({ id: "a", status: "completed" }),
        slot({ id: "b", status: "skipped" }),
      ],
      NOON,
    );
    expect(headlineOf(t)).toBe("1 of 2 done");
  });
});

describe("footnoteOf", () => {
  it("names each kind of lapse, and what is left", () => {
    const t = tallyOf(
      [
        slot({ id: "a", status: "skipped" }),
        slot({ id: "b", status: "missed" }),
        slot({ id: "c", endsAt: NOON + 60 * MINUTE }),
      ],
      NOON,
    );
    const note = footnoteOf(t, "UTC");
    expect(note).toContain("1 skipped");
    expect(note).toContain("1 missed");
    expect(note).toContain("One more");
  });

  it("says nothing about a day with nothing to admit and nothing left", () => {
    expect(
      footnoteOf(tallyOf([slot({ status: "completed" })], NOON), "UTC"),
    ).toBe("");
  });
});

describe("clockOf", () => {
  /**
   * The zone comes from the day, not from the machine. Someone whose schedule
   * is in one place and whose laptop is in another must not be told their last
   * block runs through an hour that is not on their day.
   */
  it("reads the time in the day's own zone", () => {
    expect(clockOf(NOON, "UTC")).not.toBe(clockOf(NOON, "Asia/Tokyo"));
  });

  it("falls back rather than throwing on a zone it does not know", () => {
    expect(clockOf(NOON, "Mars/Olympus")).toMatch(/\d/);
  });
});

describe("spanOf", () => {
  it("reads minutes under an hour, and hours above one", () => {
    expect(spanOf(45)).toBe("45 m");
    expect(spanOf(120)).toBe("2 h");
    expect(spanOf(130)).toBe("2 h 10");
  });
});
