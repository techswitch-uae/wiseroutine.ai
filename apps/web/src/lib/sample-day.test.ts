import { describe, expect, it } from "vitest";
import {
  activities,
  at,
  dayEnd,
  dayStart,
  type SampleState,
  sampleDay,
} from "./sample-day";

describe("the launch demonstration uses the product's scheduler", () => {
  it("places both activities, with the requested durations, around meetings", () => {
    const day = sampleDay("planned");
    expect(day.slots).toHaveLength(2);
    expect(day.slots.find((slot) => slot.activityId === "focus")).toMatchObject(
      { start: at(9, 35), end: at(10, 20) },
    );
    expect(day.slots.find((slot) => slot.activityId === "walk")).toMatchObject({
      start: at(11),
      end: at(11, 10),
    });
    expect(day.repair.moved).toEqual([]);
  });

  it("repairs only the affected block, automatically, without losing duration", () => {
    const before = sampleDay("planned");
    const after = sampleDay("changed");
    expect(after.repair.moved).toHaveLength(1);
    expect(after.repair.moved[0]?.activityId).toBe("focus");
    expect(after.repair.suggested).toEqual([]);
    expect(after.repair.blocked).toEqual([]);
    expect(after.slots.find((slot) => slot.activityId === "walk")).toEqual(
      before.slots.find((slot) => slot.activityId === "walk"),
    );
    expect(after.repair.kept).toContain("walk");
  });

  it.each<SampleState>(["planned", "changed", "full"])(
    "never presents overlapping or out-of-hours confirmed work: %s",
    (state) => {
      const day = sampleDay(state);
      for (const slot of day.slots) {
        expect(slot.start).toBeGreaterThanOrEqual(dayStart);
        expect(slot.end).toBeLessThanOrEqual(dayEnd);
        const activity = activities.find((item) => item.id === slot.activityId);
        if (!activity) throw new Error(`Unknown activity: ${slot.activityId}`);
        expect(slot.end - slot.start).toBe(activity.sessionMinutes * 60_000);
        for (const other of [
          ...day.meetings,
          ...day.slots.filter((item) => item.id !== slot.id),
        ]) {
          expect(slot.start < other.end && other.start < slot.end).toBe(false);
        }
      }
      expect(sampleDay(state)).toEqual(day);
    },
  );

  it("keeps no-space work explicit instead of pretending it was placed", () => {
    const day = sampleDay("full");
    expect(day.slots).toEqual([]);
    expect(day.repair.blocked.map((item) => item.activityId).sort()).toEqual([
      "focus",
      "walk",
    ]);
    expect(day.repair.blocked.every((item) => item.reason === "no_gap")).toBe(
      true,
    );
    expect(day.repair.suggested).toEqual([]);
    expect(sampleDay("planned").slots).toHaveLength(2);
  });
});
