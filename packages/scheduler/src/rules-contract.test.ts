import { expect, test } from "vitest";
import { plan } from "./plan";
import { ANYWHERE, rearrange } from "./rearrange";
import { canPostponeSlot, canRepairSlot, canStartSlot } from "./slot-actions";
import type { Activity } from "./types";

const M = 60_000;
const activity: Activity = {
  id: "read",
  name: "Read",
  kind: "focus",
  isActive: true,
  minimum: { type: "countPerDay", value: 1 },
  sessionMinutes: 20,
  importance: "normal",
  bufferBeforeMeetingMinutes: 0,
  daysOfWeek: 127,
};

test.each([
  {
    name: "after a long meeting",
    busyStart: 0,
    busyEnd: 60,
    end: 180,
    buffer: 0,
    expected: 70,
  },
  {
    name: "a tight full-length fit",
    busyStart: 0,
    busyEnd: 60,
    end: 80,
    buffer: 0,
    expected: 60,
  },
  {
    name: "a larger requested pre-meeting buffer",
    busyStart: 60,
    busyEnd: 120,
    end: 120,
    buffer: 15,
    expected: 25,
  },
])(
  "initial placement and repair share candidates and scoring: $name",
  ({ busyStart, busyEnd, end, buffer, expected }) => {
    const configured = { ...activity, bufferBeforeMeetingMinutes: buffer };
    const busy = [
      { start: busyStart * M, end: busyEnd * M, sourceEventIds: ["meeting"] },
    ];
    const initial = plan({
      dayStart: 0,
      dayEnd: end * M,
      busy,
      locked: [],
      demands: [
        { activity: configured, sessionsNeeded: 1, preferredAt: [50 * M] },
      ],
    });
    const repaired = rearrange({
      now: 0,
      dayStart: 0,
      dayEnd: end * M,
      busy,
      slots: [
        {
          id: "s",
          activityId: activity.id,
          status: "planned",
          start: 50 * M,
          end: 70 * M,
        },
      ],
      activities: { [activity.id]: { activity: configured, policy: ANYWHERE } },
    });
    expect(initial.unplaced).toEqual([]);
    expect(initial.placed).toMatchObject([
      { start: expected * M, end: (expected + 20) * M },
    ]);
    expect(repaired.moved[0]?.to).toEqual({
      start: expected * M,
      end: (expected + 20) * M,
    });
  },
);

test.each(["planned", "live"] as const)(
  "%s repairs only before the shared movement deadline, while Start stays available",
  (status) => {
    const slot = { status, startsAt: 50 * M, endsAt: 70 * M };
    const repairAt = (now: number) =>
      rearrange({
        now,
        dayStart: 0,
        dayEnd: 180 * M,
        busy: [{ start: 50 * M, end: 55 * M, sourceEventIds: ["meeting"] }],
        slots: [
          {
            id: "s",
            activityId: activity.id,
            status,
            start: slot.startsAt,
            end: slot.endsAt,
          },
        ],
        activities: { [activity.id]: { activity, policy: ANYWHERE } },
      });
    for (const now of [slot.startsAt, slot.startsAt + 2 * M - 1]) {
      expect(canPostponeSlot(slot, now)).toBe(true);
      expect(canRepairSlot(slot, now)).toBe(true);
      expect(repairAt(now).moved).toHaveLength(1);
    }
    for (const now of [slot.startsAt + 2 * M, slot.endsAt - 1]) {
      expect(canStartSlot(slot, now)).toBe(true);
      expect(canPostponeSlot(slot, now)).toBe(false);
      expect(repairAt(now)).toMatchObject({
        moved: [],
        suggested: [],
        blocked: [],
        frozenConflicts: ["s"],
      });
    }
    expect(canStartSlot(slot, slot.endsAt)).toBe(false);
  },
);
