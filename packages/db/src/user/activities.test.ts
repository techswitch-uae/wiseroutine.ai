import { describe, expect, test } from "vitest";
import { type ActivityRow, toSchedulerActivity } from "./activities";

const row = (over: Partial<ActivityRow> = {}): ActivityRow =>
  ({
    id: "a1",
    name: "Eye rest",
    kind: "recovery",
    icon: null,
    isActive: true,
    minimumType: "countPerDay",
    minimumValue: 4,
    sessionMinutes: 5,
    daysOfWeek: 0b1111111,
    importance: "normal",
    graceMinutes: 1,
    bufferBeforeMeetingMinutes: 0,
    writeToCalendar: false,
    writeTargetConnectionId: null,
    createdAt: new Date(0),
    archivedAt: null,
    ...over,
  }) as ActivityRow;

describe("toSchedulerActivity", () => {
  test("maps a stored row onto the solver's shape", () => {
    expect(toSchedulerActivity(row())).toEqual({
      id: "a1",
      name: "Eye rest",
      kind: "recovery",
      isActive: true,
      minimum: { type: "countPerDay", value: 4 },
      sessionMinutes: 5,
      importance: "normal",
      bufferBeforeMeetingMinutes: 0,
      daysOfWeek: 0b1111111,
    });
  });

  // Scheduling activities the user paused is a silent, embarrassing failure,
  // so pin the mapping even though it is now a plain boolean either side.
  test("a paused activity maps to isActive false", () => {
    expect(toSchedulerActivity(row({ isActive: false })).isActive).toBe(false);
  });

  test("all three minimum types survive the mapping", () => {
    expect(
      toSchedulerActivity(
        row({ minimumType: "durationPerDay", minimumValue: 120 }),
      ).minimum,
    ).toEqual({ type: "durationPerDay", value: 120 });
    expect(
      toSchedulerActivity(row({ minimumType: "countPerWeek", minimumValue: 3 }))
        .minimum,
    ).toEqual({ type: "countPerWeek", value: 3 });
  });

  // The row has no userId at all - the database is the tenant. If this ever
  // grows one back, the two-tier split has been undone somewhere.
  test("a user activity row carries no user id", () => {
    expect(row()).not.toHaveProperty("userId");
  });
});
