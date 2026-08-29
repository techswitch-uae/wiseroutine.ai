import { describe, expect, test } from "vitest";
import type { UserDatabase } from "../client";
import {
  type ActivityRow,
  createActivity,
  toSchedulerActivity,
} from "./activities";

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

/**
 * What `createActivity` actually writes.
 *
 * `data` is built field by field rather than spread from the input, which is
 * the right shape - the input is a request body's neighbour and half of it is
 * optional - but it means a column left off the list is a column silently
 * never written. That is exactly what happened to the four module columns:
 * every library activity was created as a plain slot with no `presetKey`, so
 * it had no session to run when it started and the form had nothing to show
 * when it was reopened. Nothing failed; the value just went nowhere.
 */
describe("createActivity", () => {
  /** Only the one call this makes. A real database is the API suite's job. */
  const capture = () => {
    const written: Record<string, unknown>[] = [];
    const db = {
      activity: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          written.push(data);
        },
      },
    } as unknown as UserDatabase;
    return { db, written };
  };

  const input = {
    name: "Eye rest",
    kind: "recovery",
    minimumType: "countPerDay",
    minimumValue: 4,
    sessionMinutes: 5,
  };

  test("writes the module columns it was given", async () => {
    const { db, written } = capture();
    await createActivity(
      db,
      {
        ...input,
        presetKey: "eye_rest",
        sessionEnabled: true,
        startPolicy: "auto",
        configJson: '{"metres":6}',
      },
      0,
      () => "id",
    );

    expect(written[0]).toMatchObject({
      presetKey: "eye_rest",
      sessionEnabled: true,
      startPolicy: "auto",
      configJson: '{"metres":6}',
    });
  });

  // A custom activity: no module, no session, and a start policy it can act
  // on rather than a null the sweep would have to guess at.
  test("a plain activity is created with no module and a manual start", async () => {
    const { db, written } = capture();
    await createActivity(db, input, 0, () => "id");

    expect(written[0]).toMatchObject({
      presetKey: null,
      sessionEnabled: true,
      startPolicy: "manual",
      configJson: null,
    });
  });
});
