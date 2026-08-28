import { describe, expect, test } from "vitest";
import {
  applyTick,
  changedIn,
  type DraftCalendar,
  draftFrom,
  revertIn,
} from "./calendar-draft";

/** Two accounts, two calendars each — the shape the rule exists for. */
const CALENDARS: DraftCalendar[] = [
  { id: "g1", connectionId: "google", isSelected: true },
  { id: "g2", connectionId: "google", isSelected: false },
  { id: "m1", connectionId: "ms", isSelected: true },
  { id: "m2", connectionId: "ms", isSelected: false },
];

describe("draftFrom", () => {
  test("starts as whatever the server said", () => {
    expect(draftFrom(CALENDARS)).toEqual({
      g1: true,
      g2: false,
      m1: true,
      m2: false,
    });
  });
});

describe("applyTick", () => {
  test("records the tick", () => {
    const next = applyTick(
      draftFrom(CALENDARS),
      CALENDARS,
      null,
      "google",
      "g2",
      true,
    );
    expect(next.g2).toBe(true);
  });

  test("further ticks on the same account accumulate", () => {
    let draft = draftFrom(CALENDARS);
    draft = applyTick(draft, CALENDARS, null, "google", "g2", true);
    draft = applyTick(draft, CALENDARS, "google", "google", "g1", false);
    expect(draft.g1).toBe(false);
    expect(draft.g2).toBe(true);
  });

  test("touching a second account puts the first one back", () => {
    let draft = draftFrom(CALENDARS);
    draft = applyTick(draft, CALENDARS, null, "google", "g2", true);
    expect(changedIn(draft, CALENDARS, "google")).toHaveLength(1);

    // The whole point: Google's Update and Cancel disappear rather than
    // sitting there waiting to be silently discarded by Microsoft's save.
    draft = applyTick(draft, CALENDARS, "google", "ms", "m2", true);
    expect(changedIn(draft, CALENDARS, "google")).toHaveLength(0);
    expect(changedIn(draft, CALENDARS, "ms")).toHaveLength(1);
  });

  test("ticking back to the server value leaves nothing pending", () => {
    let draft = draftFrom(CALENDARS);
    draft = applyTick(draft, CALENDARS, null, "google", "g1", false);
    draft = applyTick(draft, CALENDARS, "google", "google", "g1", true);
    expect(changedIn(draft, CALENDARS, "google")).toHaveLength(0);
  });
});

describe("changedIn", () => {
  test("only reports the account asked about", () => {
    const draft = applyTick(
      draftFrom(CALENDARS),
      CALENDARS,
      null,
      "ms",
      "m1",
      false,
    );
    expect(changedIn(draft, CALENDARS, "ms").map((c) => c.id)).toEqual(["m1"]);
    expect(changedIn(draft, CALENDARS, "google")).toEqual([]);
  });
});

describe("revertIn", () => {
  test("puts one account back and leaves the rest alone", () => {
    // Reached by hand rather than through applyTick, because the rule under
    // test is what revert does, not how the draft got into this state.
    const draft = { ...draftFrom(CALENDARS), g2: true, m2: true };
    const next = revertIn(draft, CALENDARS, "google");
    expect(next.g2).toBe(false);
    expect(next.m2).toBe(true);
  });
});
