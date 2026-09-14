import { expect, test } from "vitest";
import type { ActivityProgress, BucketItem } from "./api";
import { notPlacedRows } from "./not-placed";

const progress = {
  id: "a",
  name: "Stretch",
  kind: "recovery",
  minimumType: "countPerDay",
  minimumValue: 3,
  sessionMinutes: 10,
  count: 0,
  minutes: 0,
  scheduled: 2,
} as ActivityProgress;
const slot = (id: string, minutes = 10): BucketItem => ({
  id,
  activityId: "a",
  title: "Stretch",
  kind: "recovery",
  startsAt: 0,
  endsAt: minutes * 60_000,
  wasAt: 0,
  reasonCode: "no_gap",
  suggested: null,
});

test("saved occurrences consume demand once and are offered before new occurrences", () => {
  expect(notPlacedRows([progress], [slot("s1"), slot("s2")])).toEqual([
    expect.objectContaining({
      activityId: "a",
      slotId: "s1",
      count: 3,
      minutes: 10,
    }),
  ]);
});
test("different saved durations are not presented as interchangeable slots", () => {
  const rows = notPlacedRows([progress], [slot("s1", 30), slot("s2")]);
  expect(rows.map((row) => [row.slotId, row.minutes, row.count])).toEqual([
    ["s1", 30, 1],
    ["s2", 10, 2],
  ]);
});
test("completion and existing placements produce no fresh duplicates", () => {
  expect(
    notPlacedRows([{ ...progress, count: 1 }], [slot("s1"), slot("s2")])[0]
      ?.count,
  ).toBe(2);
  expect(notPlacedRows([{ ...progress, scheduled: 3 }], [])).toEqual([]);
});
test("unrelated one-off slots remain separate even when their titles match", () => {
  const rows = notPlacedRows(
    [],
    [
      { ...slot("s1"), activityId: null },
      { ...slot("s2"), activityId: null },
    ],
  );
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.slotId)).toEqual(["s1", "s2"]);
});
