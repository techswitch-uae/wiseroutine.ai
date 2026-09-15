import {
  type Activity,
  ANYWHERE,
  type BusyBlock,
  type CurrentSlot,
  plan,
  rearrange,
} from "@wiseroutine/scheduler";

// Entirely synthetic, fixed UTC instants: SSR, visitors and screenshots see
// the same day. No provider requests, auth, storage or real calendar data.
export const at = (hours: number, minutes = 0) =>
  Date.UTC(2030, 0, 14, hours, minutes);
export const dayStart = at(9);
export const dayEnd = at(12, 30);
export type SampleState = "planned" | "changed" | "full";

export const activities: Activity[] = [
  {
    id: "focus",
    name: "Deep work",
    kind: "focus",
    isActive: true,
    minimum: { type: "countPerDay", value: 1 },
    sessionMinutes: 45,
    importance: "normal",
    bufferBeforeMeetingMinutes: 0,
    daysOfWeek: 127,
  },
  {
    id: "walk",
    name: "Walk",
    kind: "recovery",
    isActive: true,
    minimum: { type: "countPerDay", value: 1 },
    sessionMinutes: 10,
    importance: "normal",
    bufferBeforeMeetingMinutes: 0,
    daysOfWeek: 127,
  },
];

export const time = (instant: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);

export const range = (slot: { start: number; end: number }) =>
  `${time(slot.start)}–${time(slot.end)}`;

export function sampleDay(state: SampleState) {
  const originalMeetings = [
    { id: "check-in", name: "Team check-in", start: at(9), end: at(9, 30) },
    { id: "review", name: "Design review", start: at(11, 30), end: at(12) },
  ];
  const busy = (meetings: typeof originalMeetings): BusyBlock[] =>
    meetings.map(({ id, start, end }) => ({
      start,
      end,
      sourceEventIds: [id],
    }));
  const initial = plan({
    dayStart,
    dayEnd,
    busy: busy(originalMeetings),
    locked: [],
    demands: activities.map((activity) => ({
      activity,
      sessionsNeeded: 1,
      // A late-morning walk stays clear while the earlier focus slot repairs.
      // This is a soft routine preference, resolved by the real planner.
      preferredAt: activity.id === "walk" ? [at(11)] : [],
    })),
  });
  const originalSlots: CurrentSlot[] = initial.placed.map((slot) => ({
    ...slot,
    id: slot.activityId,
    status: "planned",
  }));
  const meetings = originalMeetings.map((meeting) =>
    meeting.id === "check-in" && state !== "planned"
      ? { ...meeting, end: at(9, 50) }
      : meeting,
  );
  if (state === "full") {
    meetings.push(
      {
        id: "workshop",
        name: "Project workshop",
        start: at(9, 50),
        end: at(11, 30),
      },
      { id: "call", name: "Client call", start: at(12), end: dayEnd },
    );
  }
  const repair = rearrange({
    now: dayStart,
    dayStart,
    dayEnd,
    busy: busy(meetings),
    slots: originalSlots,
    activities: Object.fromEntries(
      activities.map((activity) => [
        activity.id,
        { activity, policy: ANYWHERE },
      ]),
    ),
  });
  // Never display a suggestion or blocked occurrence as a confirmed placement.
  const slots = originalSlots.flatMap((slot) => {
    if (repair.blocked.some((item) => item.slotId === slot.id)) return [];
    if (repair.suggested.some((item) => item.slotId === slot.id)) return [];
    const move = repair.moved.find((item) => item.slotId === slot.id);
    return [{ ...slot, ...(move?.to ?? {}) }];
  });
  return { meetings, slots, originalSlots, repair };
}
