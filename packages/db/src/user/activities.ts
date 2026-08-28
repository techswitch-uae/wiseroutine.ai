import type { Activity } from "@wiseroutine/scheduler";
import { at, type UserDatabase } from "../client";
import type { Activity as ActivityRow } from "../generated/user/client";

export type { Activity as ActivityRow } from "../generated/user/client";

export interface ActivityWithWindows {
  row: ActivityRow;
  /** Minutes from local midnight. Wall-clock, so it follows the user's zone. */
  anchorMinutes: number[];
}

export async function listActivities(
  db: UserDatabase,
): Promise<ActivityWithWindows[]> {
  // One query with the windows included, rather than N+1.
  const rows = await db.activity.findMany({
    where: { archivedAt: null },
    include: { windows: { select: { anchorMinutes: true } } },
  });

  return rows.map(({ windows, ...row }) => ({
    row: row as ActivityRow,
    anchorMinutes: windows.map((w) => w.anchorMinutes),
  }));
}

/** The free-plan limit counts *active* activities, so pausing frees a slot. */
export function countActiveActivities(db: UserDatabase): Promise<number> {
  return db.activity.count({ where: { isActive: true, archivedAt: null } });
}

export interface ActivityInput {
  name: string;
  kind: string;
  icon?: string | null;
  isActive?: boolean;
  minimumType: string;
  minimumValue: number;
  sessionMinutes: number;
  daysOfWeek?: number;
  importance?: string;
  graceMinutes?: number;
  bufferBeforeMeetingMinutes?: number;
  anchorMinutes?: number[];
}

export async function createActivity(
  db: UserDatabase,
  input: ActivityInput,
  now: number,
  newId: () => string,
): Promise<string> {
  const id = newId();
  const { anchorMinutes = [], ...activity } = input;

  await db.activity.create({
    data: {
      id,
      name: activity.name,
      kind: activity.kind,
      icon: activity.icon ?? null,
      isActive: activity.isActive ?? true,
      minimumType: activity.minimumType,
      minimumValue: activity.minimumValue,
      sessionMinutes: activity.sessionMinutes,
      daysOfWeek: activity.daysOfWeek ?? 0b1111111,
      importance: activity.importance ?? "normal",
      graceMinutes: activity.graceMinutes ?? 3,
      bufferBeforeMeetingMinutes: activity.bufferBeforeMeetingMinutes ?? 0,
      createdAt: at(now),
      windows: {
        create: anchorMinutes.map((minutes) => ({
          id: newId(),
          anchorMinutes: minutes,
        })),
      },
    },
  });

  return id;
}

export async function updateActivity(
  db: UserDatabase,
  activityId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.activity.updateMany({ where: { id: activityId }, data: patch });
}

/** Paused, not deleted - 3e treats Paused as a first-class state, and the
 *  missed list still needs the activity's history. */
export async function setActivityActive(
  db: UserDatabase,
  activityId: string,
  isActive: boolean,
): Promise<void> {
  await updateActivity(db, activityId, { isActive });
}

/** Map a stored row onto the solver's shape. */
export function toSchedulerActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Activity["kind"],
    isActive: row.isActive,
    minimum: {
      type: row.minimumType,
      value: row.minimumValue,
    } as Activity["minimum"],
    sessionMinutes: row.sessionMinutes,
    importance: row.importance as Activity["importance"],
    bufferBeforeMeetingMinutes: row.bufferBeforeMeetingMinutes,
    daysOfWeek: row.daysOfWeek,
  };
}

/** The starter library from screen 3e. Seeded into a user's database when it
 *  is provisioned. */
export const ACTIVITY_TEMPLATES: readonly ActivityInput[] = [
  {
    name: "Back & shoulder stretch",
    kind: "recovery",
    minimumType: "countPerDay",
    minimumValue: 3,
    sessionMinutes: 10,
    importance: "normal",
    graceMinutes: 3,
    bufferBeforeMeetingMinutes: 5,
    anchorMinutes: [10 * 60, 15 * 60],
  },
  {
    name: "Eye rest",
    kind: "recovery",
    minimumType: "countPerDay",
    minimumValue: 4,
    sessionMinutes: 5,
    importance: "normal",
    graceMinutes: 1,
    bufferBeforeMeetingMinutes: 0,
  },
  {
    name: "Deep work",
    kind: "focus",
    minimumType: "durationPerDay",
    minimumValue: 120,
    sessionMinutes: 25,
    importance: "high",
    graceMinutes: 10,
    bufferBeforeMeetingMinutes: 5,
    anchorMinutes: [9 * 60],
  },
  {
    name: "Walk",
    kind: "recovery",
    minimumType: "countPerWeek",
    minimumValue: 3,
    sessionMinutes: 15,
    importance: "low",
    graceMinutes: 10,
    bufferBeforeMeetingMinutes: 5,
    anchorMinutes: [13 * 60],
  },
  {
    name: "Meditation",
    kind: "recovery",
    minimumType: "countPerDay",
    minimumValue: 1,
    sessionMinutes: 10,
    importance: "normal",
    graceMinutes: 3,
    bufferBeforeMeetingMinutes: 0,
    anchorMinutes: [7 * 60],
  },
  {
    name: "Hydration",
    kind: "recovery",
    minimumType: "countPerDay",
    minimumValue: 4,
    sessionMinutes: 5,
    importance: "low",
    graceMinutes: 1,
    bufferBeforeMeetingMinutes: 0,
  },
];
