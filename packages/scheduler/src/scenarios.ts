/**
 * Every way a day can go wrong, written down once.
 *
 * These exist twice over. The simulator renders them so a human can look at a
 * repair and say "no, not there" - which is the only way to settle questions
 * like whether a morning stretch pushed to four o'clock should be offered or
 * refused. And once settled, the same objects are the test corpus: a scenario
 * with an `expect` block is a regression test, and one without is a question
 * still open.
 *
 * `expect` is a *complete* specification. A key left out means "none of those",
 * not "don't check" - so a scenario that starts producing an extra suggestion
 * fails, which is the whole point of writing them down.
 *
 * Written in wall-clock strings rather than instants on purpose. A scenario
 * nobody can read is a scenario nobody checks, and the whole point is that a
 * person checks them. `runScenario` resolves them against the zone.
 */

import type { BusyOptions } from "./busy";
import { toBusyBlocks } from "./busy";
import type { LocalDate } from "./localtime";
import { preferredInstant } from "./localtime";
import type {
  BlockedReason,
  BreatherRule,
  CurrentSlot,
  PlacementPolicy,
  PlacementReason,
  RearrangeInput,
  RearrangeResult,
  SlotStatus,
} from "./rearrange";
import { NO_BREATHER, rearrange, resolveBreather } from "./rearrange";
import type {
  Activity,
  BusyBlock,
  BusyStatus,
  CalendarEvent,
  EventKind,
  Importance,
  Instant,
  ResponseStatus,
} from "./types";

/* ── Scenario shape ──────────────────────────────────────────────────────── */

/** "09:30". The only time format a scenario ever writes. */
export type Clock = string;

export interface ScenarioActivity {
  id: string;
  name: string;
  kind: "recovery" | "focus" | "task";
  sessionMinutes: number;
  importance?: Importance;
  bufferBeforeMeetingMinutes?: number;
  /** Allowed regions as [from, to] pairs. Omitted means anywhere in the day. */
  windows?: [Clock, Clock][];
  /** Sessions should be spaced across the allowed region. */
  spread?: boolean;
}

export interface ScenarioEvent {
  id: string;
  title: string;
  start: Clock;
  end: Clock;
  calendarId?: string;
  icalUid?: string;
  isAllDay?: boolean;
  kind?: EventKind;
  busyStatus?: BusyStatus;
  responseStatus?: ResponseStatus;
  isCancelled?: boolean;
}

export interface ScenarioSlot {
  id: string;
  activityId: string;
  start: Clock;
  /** Defaults to start + the activity's session length. */
  end?: Clock;
  status?: SlotStatus;
}

/** What the sync delivered. Several may land at once - two meetings dragged in
 *  one Outlook session arrive as one change to us. */
export type ScenarioChange =
  | { op: "move"; eventId: string; to: Clock }
  | { op: "resize"; eventId: string; start?: Clock; end?: Clock }
  | { op: "add"; event: ScenarioEvent }
  | { op: "remove"; eventId: string }
  | { op: "patch"; eventId: string; patch: Partial<ScenarioEvent> };

/**
 * The settled outcome, as `[slot, time]` pairs a person can read.
 *
 * Complete, not partial: whatever is not listed must not happen.
 */
export interface ScenarioExpectation {
  moved?: [slotId: string, at: Clock][];
  suggested?: [slotId: string, at: Clock, why: PlacementReason[]][];
  blocked?: [slotId: string, why: BlockedReason][];
  /** Slots that clash and are no longer ours to move. */
  frozen?: string[];
}

export interface Scenario {
  id: string;
  title: string;
  /** What this scenario is actually asking. Shown in the simulator. */
  probes: string;
  tags: string[];
  timeZone?: string;
  date?: LocalDate;
  now?: Clock;
  day?: [Clock, Clock];
  /** How generously to read the calendar. The corpus takes the literal
   *  reading - see `BusyOptions.literal`. */
  busy?: BusyOptions;
  /** How much room to leave around a session. Omitted takes the default;
   *  the H group is where the other settings get exercised. */
  breather?: Partial<BreatherRule>;
  activities: ScenarioActivity[];
  events: ScenarioEvent[];
  slots: ScenarioSlot[];
  changes: ScenarioChange[];
  expect?: ScenarioExpectation;
}

/* ── Defaults ────────────────────────────────────────────────────────────── */

const ZONE = "Europe/London";
/** A Tuesday, far enough from any DST edge to be unremarkable. */
const DATE: LocalDate = { year: 2026, month: 3, day: 10 };
const DAY: [Clock, Clock] = ["08:00", "18:00"];
const NOW: Clock = "09:00";
/**
 * If it is on the calendar and has a duration, it takes time.
 *
 * The alternative is inferring which entries are "really" metadata, and every
 * such inference schedules a session inside something real when it guesses
 * wrong. See `BusyOptions.literal`.
 */
const BUSY: BusyOptions = { literal: true };

const minutesOf = (clock: Clock): number => {
  const [h = "0", m = "0"] = clock.split(":");
  return Number(h) * 60 + Number(m);
};

export const clockOf = (instant: Instant, timeZone: string = ZONE): Clock =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));

/* ── Activity presets, so a scenario says what it is about ───────────────── */

const deepWork: ScenarioActivity = {
  id: "deep-work",
  name: "Deep work",
  kind: "focus",
  sessionMinutes: 50,
  importance: "high",
};

const morningStretch: ScenarioActivity = {
  id: "stretch",
  name: "Morning stretch",
  kind: "recovery",
  sessionMinutes: 15,
  windows: [["08:00", "12:00"]],
};

const eyeRest: ScenarioActivity = {
  id: "eye-rest",
  name: "Eye rest",
  kind: "recovery",
  sessionMinutes: 10,
  spread: true,
};

const walk: ScenarioActivity = {
  id: "walk",
  name: "Walk",
  kind: "recovery",
  sessionMinutes: 20,
  windows: [
    ["08:00", "10:00"],
    ["16:00", "18:00"],
  ],
};

/* ── Building ────────────────────────────────────────────────────────────── */

export interface BuiltScenario {
  scenario: Scenario;
  timeZone: string;
  /** The gap rule actually in force, already resolved. Read this rather than
   *  reaching for the default - a scenario may have overridden it. */
  breather: BreatherRule;
  date: LocalDate;
  now: Instant;
  dayStart: Instant;
  dayEnd: Instant;
  eventsBefore: CalendarEvent[];
  eventsAfter: CalendarEvent[];
  busyBefore: BusyBlock[];
  busyAfter: BusyBlock[];
  slots: CurrentSlot[];
  activities: Record<string, { activity: Activity; policy: PlacementPolicy }>;
  input: RearrangeInput;
  result: RearrangeResult;
}

function toCalendarEvent(
  event: ScenarioEvent,
  at: (clock: Clock) => Instant,
): CalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendarId ?? "primary",
    ...(event.icalUid === undefined ? {} : { icalUid: event.icalUid }),
    title: event.title,
    start: at(event.start),
    end: at(event.end),
    isAllDay: event.isAllDay ?? false,
    kind: event.kind ?? "default",
    busyStatus: event.busyStatus ?? "busy",
    responseStatus: event.responseStatus ?? "accepted",
    isCancelled: event.isCancelled ?? false,
  };
}

/** Apply the sync. Returns the event list as the provider would now report it. */
function applyChanges(
  events: ScenarioEvent[],
  changes: readonly ScenarioChange[],
): ScenarioEvent[] {
  let next = events.map((e) => ({ ...e }));

  for (const change of changes) {
    switch (change.op) {
      case "add":
        next.push({ ...change.event });
        break;
      case "remove":
        next = next.filter((e) => e.id !== change.eventId);
        break;
      case "move": {
        const event = next.find((e) => e.id === change.eventId);
        if (!event) break;
        // A dragged meeting keeps its length; that is what makes it a move.
        const length = minutesOf(event.end) - minutesOf(event.start);
        const start = minutesOf(change.to);
        event.start = change.to;
        event.end = `${String(Math.floor((start + length) / 60)).padStart(2, "0")}:${String((start + length) % 60).padStart(2, "0")}`;
        break;
      }
      case "resize": {
        const event = next.find((e) => e.id === change.eventId);
        if (!event) break;
        if (change.start !== undefined) event.start = change.start;
        if (change.end !== undefined) event.end = change.end;
        break;
      }
      case "patch": {
        const index = next.findIndex((e) => e.id === change.eventId);
        const found = next[index];
        if (index < 0 || !found) break;
        next[index] = { ...found, ...change.patch };
        break;
      }
    }
  }
  return next;
}

/** Resolve a scenario and run the engine over it. Pure - the simulator, the
 *  tests and any future replay all call exactly this. */
export function runScenario(scenario: Scenario): BuiltScenario {
  const timeZone = scenario.timeZone ?? ZONE;
  const date = scenario.date ?? DATE;
  const at = (clock: Clock): Instant =>
    preferredInstant(date, timeZone, minutesOf(clock));

  const [dayFrom, dayTo] = scenario.day ?? DAY;
  const dayStart = at(dayFrom);
  const dayEnd = at(dayTo);
  const now = at(scenario.now ?? NOW);
  const busyOptions = scenario.busy ?? BUSY;
  const breather = resolveBreather(scenario.breather);

  const byId = new Map(scenario.activities.map((a) => [a.id, a]));

  const activities: BuiltScenario["activities"] = {};
  for (const spec of scenario.activities) {
    activities[spec.id] = {
      activity: {
        id: spec.id,
        name: spec.name,
        kind: spec.kind,
        isActive: true,
        minimum: { type: "countPerDay", value: 1 },
        sessionMinutes: spec.sessionMinutes,
        importance: spec.importance ?? "normal",
        bufferBeforeMeetingMinutes: spec.bufferBeforeMeetingMinutes ?? 0,
        daysOfWeek: 0b1111111,
      },
      policy: {
        windows: (spec.windows ?? []).map(([from, to]) => ({
          start: at(from),
          end: at(to),
        })),
        spread: spec.spread ?? false,
      },
    };
  }

  const slots: CurrentSlot[] = scenario.slots.map((slot) => {
    const spec = byId.get(slot.activityId);
    const start = at(slot.start);
    return {
      id: slot.id,
      activityId: slot.activityId,
      start,
      end: slot.end
        ? at(slot.end)
        : start + (spec?.sessionMinutes ?? 30) * 60_000,
      status: slot.status ?? "planned",
    };
  });

  const eventsBefore = scenario.events.map((e) => toCalendarEvent(e, at));
  const eventsAfter = applyChanges(scenario.events, scenario.changes).map((e) =>
    toCalendarEvent(e, at),
  );

  const input: RearrangeInput = {
    now,
    dayStart,
    dayEnd,
    busy: toBusyBlocks(eventsAfter, busyOptions),
    slots,
    activities,
    breather,
  };

  return {
    scenario,
    timeZone,
    breather,
    date,
    now,
    dayStart,
    dayEnd,
    eventsBefore,
    eventsAfter,
    busyBefore: toBusyBlocks(eventsBefore, busyOptions),
    busyAfter: input.busy,
    slots,
    activities,
    input,
    result: rearrange(input),
  };
}

/* ── The corpus ──────────────────────────────────────────────────────────── */

/**
 * Grouped so the simulator can walk them in a sensible order and so a gap in
 * coverage is visible as a thin group rather than a missing id.
 */
export const SCENARIOS: readonly Scenario[] = [
  /* ── A. Plain repair ───────────────────────────────────────────────────── */
  {
    id: "a1-meeting-moved-onto-slot",
    title: "Meeting dragged onto a focus block",
    probes:
      "The base case. One meeting moves, one slot is buried, there is room right after - with five minutes to close the laptop.",
    tags: ["repair", "auto"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Standup", start: "11:00", end: "11:30" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:00" }],
    expect: {
      moved: [["s1", "10:35"]],
    },
  },
  {
    id: "a2-meeting-extended-over-slot",
    title: "Meeting extended over the slot",
    probes:
      "A resize, not a move. The overlap arrives from the end of a meeting that was already there, and the only room left is over an hour away.",
    tags: ["repair", "drift"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Review", start: "09:15", end: "10:00" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", end: "11:00" }],
    expect: {
      suggested: [["s1", "11:10", ["large_drift"]]],
    },
  },
  {
    id: "a4-meeting-deleted-frees-morning",
    title: "Meeting cancelled, slot already elsewhere",
    probes:
      "The good slot the meeting had stolen is free again. Nothing broke, so nothing moves.",
    tags: ["no-op"],
    activities: [morningStretch],
    events: [{ id: "m1", title: "Client call", start: "09:00", end: "10:00" }],
    slots: [{ id: "s1", activityId: "stretch", start: "11:30" }],
    changes: [{ op: "remove", eventId: "m1" }],
    expect: {},
  },
  {
    id: "a5-meeting-ends-exactly-at-the-slot",
    title: "Meeting extended to touch the slot but not overlap it",
    probes:
      "Touching is not overlapping, and a repair needs a collision to react to. The breather decides where a slot goes; it is never a reason to move one that is fine.",
    tags: ["boundary", "no-op"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Sync", start: "09:10", end: "09:56" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", end: "10:00" }],
    expect: {},
  },
  {
    id: "a6-meeting-overruns-the-slot-by-one-minute",
    title: "Meeting overruns the slot by a single minute",
    probes:
      "The smallest real collision. Any overlap is an overlap - the version that ignored small ones let a meeting eat the top of a session while the app said all was well.",
    tags: ["boundary", "repair"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Sync", start: "09:10", end: "09:56" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", end: "10:01" }],
    expect: {
      moved: [["s1", "10:11"]],
    },
  },

  /* ── B. Windows ────────────────────────────────────────────────────────── */
  {
    id: "b1-morning-window-still-fits",
    title: "Morning stretch displaced, morning still has room",
    probes: "Inside the window, so it moves without asking.",
    tags: ["window", "auto"],
    activities: [morningStretch],
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "stretch", start: "09:30" }],
    changes: [{ op: "move", eventId: "m1", to: "09:30" }],
    expect: {
      moved: [["s1", "09:10"]],
    },
  },
  {
    id: "b2-morning-window-overflows",
    title: "Morning is full, the only room is the afternoon",
    probes:
      "The headline case. A morning stretch at midday is a decision, not a repair - so we suggest and wait.",
    tags: ["window", "suggest"],
    activities: [morningStretch],
    events: [
      { id: "m1", title: "Workshop", start: "13:00", end: "13:30" },
      { id: "m2", title: "Blocked", start: "10:00", end: "12:00" },
    ],
    slots: [{ id: "s1", activityId: "stretch", start: "09:30" }],
    changes: [{ op: "resize", eventId: "m2", start: "09:00" }],
    expect: {
      suggested: [["s1", "12:10", ["outside_window"]]],
    },
  },
  {
    id: "b3-morning-window-overflow-blocked",
    title: "Morning full, afternoon full too",
    probes: "Nowhere at all. No guess, just the bucket.",
    tags: ["window", "blocked"],
    activities: [morningStretch],
    events: [
      { id: "m1", title: "All hands", start: "09:00", end: "13:00" },
      { id: "m2", title: "Offsite", start: "13:00", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "stretch", start: "09:30" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:00" }],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
  {
    id: "b4-two-windows-second-one-free",
    title: "Two windows, the early one is gone",
    probes:
      "A walk allowed 08:00-10:00 or 16:00-18:00. Losing the morning should land it in the evening, silently - a window beats any amount of distance.",
    tags: ["window", "auto"],
    activities: [walk],
    events: [{ id: "m1", title: "Interview", start: "11:00", end: "12:00" }],
    slots: [{ id: "s1", activityId: "walk", start: "09:00" }],
    changes: [{ op: "move", eventId: "m1", to: "08:30" }],
    expect: {
      moved: [["s1", "09:40"]],
    },
  },
  {
    id: "b5-straddles-the-window-edge",
    title: "Only room straddles the end of the window",
    probes:
      "11:50-12:05 is not a morning stretch. The whole slot has to be inside, so this is a suggestion.",
    tags: ["window", "suggest"],
    activities: [morningStretch],
    events: [
      { id: "m1", title: "Blocked", start: "09:00", end: "11:50" },
      { id: "m2", title: "Lunch and learn", start: "12:05", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "stretch", start: "09:30" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:00" }],
    expect: {
      suggested: [["s1", "11:50", ["outside_window"]]],
    },
  },
  {
    id: "b6-window-narrower-than-session",
    title: "Window shorter than the session it holds",
    probes:
      "A misconfiguration, not a calendar problem. The window can never be satisfied - we must not loop, and the suggestion is what surfaces it.",
    tags: ["window", "config"],
    activities: [
      {
        id: "stretch",
        name: "Morning stretch",
        kind: "recovery",
        sessionMinutes: 45,
        windows: [["08:00", "08:30"]],
      },
    ],
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "stretch", start: "09:30" }],
    changes: [{ op: "move", eventId: "m1", to: "09:30" }],
    expect: {
      suggested: [["s1", "10:05", ["outside_window"]]],
    },
  },

  /* ── C. Spacing between sessions of one activity ───────────────────────── */
  {
    id: "c1-spread-displaced-keeps-spacing",
    title: "One of four eye rests displaced, spacing survives",
    probes:
      "Spacing intact, so it just moves - and it takes the five minutes before the meeting rather than sitting flush against it.",
    tags: ["spread", "breather", "auto"],
    activities: [eyeRest],
    events: [{ id: "m1", title: "Call", start: "15:00", end: "15:30" }],
    slots: [
      { id: "s1", activityId: "eye-rest", start: "09:30" },
      { id: "s2", activityId: "eye-rest", start: "12:00" },
      { id: "s3", activityId: "eye-rest", start: "14:30" },
      { id: "s4", activityId: "eye-rest", start: "17:00" },
    ],
    changes: [{ op: "move", eventId: "m1", to: "14:25" }],
    expect: {
      moved: [["s3", "14:10"]],
    },
  },
  {
    id: "c2-nowhere-far-enough-from-a-sibling",
    title: "The only room is shoulder to shoulder with another eye rest",
    probes:
      "Two eye rests twenty minutes apart is one eye rest. There is no version of that worth offering, so it goes to the bucket rather than being suggested.",
    tags: ["spread", "blocked"],
    activities: [eyeRest],
    events: [
      { id: "m1", title: "Call", start: "09:30", end: "10:00" },
      { id: "m2", title: "Workshop", start: "10:00", end: "14:20" },
      { id: "m3", title: "Review", start: "14:45", end: "16:55" },
    ],
    slots: [
      { id: "s1", activityId: "eye-rest", start: "09:30" },
      { id: "s2", activityId: "eye-rest", start: "14:30" },
      { id: "s3", activityId: "eye-rest", start: "17:00" },
    ],
    changes: [{ op: "resize", eventId: "m1", start: "08:00" }],
    expect: {
      blocked: [["s1", "too_close"]],
    },
  },
  {
    id: "c3-spread-two-displaced-at-once",
    title: "A long meeting takes two of four eye rests",
    probes:
      "Both need homes, and the second must not be offered the space the first just took.",
    tags: ["spread", "cascade"],
    activities: [eyeRest],
    events: [{ id: "m1", title: "Planning", start: "11:00", end: "11:30" }],
    slots: [
      { id: "s1", activityId: "eye-rest", start: "09:30" },
      { id: "s2", activityId: "eye-rest", start: "11:30" },
      { id: "s3", activityId: "eye-rest", start: "12:30" },
      { id: "s4", activityId: "eye-rest", start: "16:00" },
    ],
    changes: [{ op: "resize", eventId: "m1", start: "11:15", end: "13:00" }],
    expect: {
      moved: [
        ["s2", "13:10"],
        ["s3", "17:40"],
      ],
    },
  },
  {
    id: "c4-spread-collapses-to-back-to-back",
    title: "Day so full the rests can only go back to back",
    probes:
      "One fits, one fits after it, and the third has nowhere far enough from the second. The last goes to the bucket rather than being crammed in beside its sibling.",
    tags: ["spread", "blocked", "tight"],
    activities: [eyeRest],
    events: [
      { id: "m1", title: "Marathon", start: "09:30", end: "17:20" },
      { id: "m2", title: "Later", start: "17:45", end: "18:00" },
    ],
    slots: [
      { id: "s1", activityId: "eye-rest", start: "10:00" },
      { id: "s2", activityId: "eye-rest", start: "12:00" },
      { id: "s3", activityId: "eye-rest", start: "15:00" },
    ],
    changes: [{ op: "resize", eventId: "m1", start: "09:10" }],
    expect: {
      moved: [
        ["s1", "09:00"],
        ["s2", "17:30"],
      ],
      blocked: [["s3", "too_close"]],
    },
  },
  {
    id: "c5-spread-single-session",
    title: "A spread activity with only one session today",
    probes:
      "Spacing is meaningless with one session. The check must not fire on nothing.",
    tags: ["spread", "auto"],
    activities: [eyeRest],
    events: [{ id: "m1", title: "Call", start: "15:00", end: "15:30" }],
    slots: [{ id: "s1", activityId: "eye-rest", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:00" }],
    expect: {
      moved: [["s1", "09:45"]],
    },
  },
  {
    id: "c6-spread-with-window",
    title: "Spread inside a window",
    probes:
      "Both rules at once: three walks, morning only. Spacing is measured across the window, not the day, so the requirement is tighter than it looks.",
    tags: ["spread", "window"],
    activities: [
      {
        id: "walk",
        name: "Walk",
        kind: "recovery",
        sessionMinutes: 20,
        windows: [["08:00", "12:00"]],
        spread: true,
      },
    ],
    events: [{ id: "m1", title: "Call", start: "14:00", end: "14:30" }],
    slots: [
      { id: "s1", activityId: "walk", start: "08:15" },
      { id: "s2", activityId: "walk", start: "09:45" },
      { id: "s3", activityId: "walk", start: "11:15" },
    ],
    changes: [{ op: "move", eventId: "m1", to: "09:45" }],
    expect: {
      moved: [["s2", "09:23"]],
    },
  },
  {
    id: "c7-two-sessions-of-an-unspread-activity",
    title: "Two deep-work blocks pushed into one gap",
    probes:
      "No spread flag, but two sessions of the same thing back to back is one long session that lies about being two. The floor applies to every activity, not only the spread ones.",
    tags: ["spacing", "blocked"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:00" },
      { id: "m2", title: "Afternoon", start: "12:30", end: "18:00" },
    ],
    // The 10:00-11:00 gap is long enough for the session and nothing else is,
    // so the only question left is how close to s2 that puts it.
    slots: [
      { id: "s1", activityId: "deep-work", start: "09:30" },
      { id: "s2", activityId: "deep-work", start: "11:00" },
    ],
    changes: [{ op: "resize", eventId: "m1", end: "10:00" }],
    expect: {
      blocked: [["s1", "too_close"]],
    },
  },

  /* ── D. Cascades and multiple changes ──────────────────────────────────── */
  {
    id: "d1-long-meeting-covers-three-slots",
    title: "One meeting swallows three slots",
    probes:
      "The cascade. Three repairs in time order, each taking what the last left.",
    tags: ["cascade"],
    activities: [deepWork, eyeRest, morningStretch],
    events: [{ id: "m1", title: "Workshop", start: "14:00", end: "15:00" }],
    slots: [
      { id: "s1", activityId: "stretch", start: "09:15" },
      { id: "s2", activityId: "eye-rest", start: "10:00" },
      { id: "s3", activityId: "deep-work", start: "10:30" },
    ],
    changes: [{ op: "resize", eventId: "m1", start: "09:10", end: "11:30" }],
    expect: {
      moved: [
        ["s1", "11:40"],
        ["s2", "09:00"],
      ],
      suggested: [["s3", "12:00", ["large_drift"]]],
    },
  },
  {
    id: "d2-two-meetings-moved-at-once",
    title: "Two meetings moved in one sync",
    probes:
      "One webhook, two collisions in different parts of the day. Neither repair may assume it is alone.",
    tags: ["cascade", "multi"],
    activities: [deepWork, eyeRest],
    events: [
      { id: "m1", title: "One to one", start: "13:00", end: "13:30" },
      { id: "m2", title: "Vendor", start: "16:00", end: "16:30" },
    ],
    slots: [
      { id: "s1", activityId: "deep-work", start: "10:00" },
      { id: "s2", activityId: "eye-rest", start: "14:00" },
    ],
    changes: [
      { op: "move", eventId: "m1", to: "10:15" },
      { op: "move", eventId: "m2", to: "14:00" },
    ],
    expect: {
      moved: [
        ["s1", "09:20"],
        ["s2", "13:45"],
      ],
    },
  },
  {
    id: "d3-cascade-runs-out-of-day",
    title: "Three deep-work blocks, room for fewer",
    probes:
      "Some find homes far enough apart and the rest do not. A partial answer is still an answer - it must not fail the lot, and it must not cram them together to avoid the bucket.",
    tags: ["cascade", "spacing", "blocked"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Workshop", start: "12:00", end: "12:30" },
      { id: "m2", title: "Evening", start: "15:40", end: "18:00" },
    ],
    slots: [
      { id: "s1", activityId: "deep-work", start: "09:30" },
      { id: "s2", activityId: "deep-work", start: "10:30" },
      { id: "s3", activityId: "deep-work", start: "11:30" },
    ],
    changes: [{ op: "resize", eventId: "m1", start: "09:20", end: "13:00" }],
    expect: {
      suggested: [
        ["s1", "13:10", ["large_drift"]],
        ["s2", "14:30", ["large_drift"]],
      ],
      blocked: [["s3", "no_gap"]],
    },
  },
  {
    id: "d4-meetings-shift-back-to-back",
    title: "A chain of meetings all shift thirty minutes",
    probes:
      "The everyday version: the whole morning slides, and the slots between them have to slide too.",
    tags: ["cascade", "multi"],
    activities: [eyeRest],
    events: [
      { id: "m1", title: "Standup", start: "09:30", end: "10:00" },
      { id: "m2", title: "Design", start: "10:30", end: "11:30" },
      { id: "m3", title: "Vendor", start: "12:00", end: "13:00" },
    ],
    slots: [
      { id: "s1", activityId: "eye-rest", start: "10:05" },
      { id: "s2", activityId: "eye-rest", start: "11:35" },
      { id: "s3", activityId: "eye-rest", start: "15:00" },
    ],
    changes: [
      { op: "move", eventId: "m1", to: "10:00" },
      { op: "move", eventId: "m2", to: "11:00" },
      { op: "move", eventId: "m3", to: "12:30" },
    ],
    expect: {
      moved: [
        ["s1", "09:45"],
        ["s2", "12:10"],
      ],
    },
  },
  {
    id: "d5-repair-may-not-evict-a-healthy-slot",
    title: "The best space belongs to an untouched slot",
    probes:
      "A deliberate limit: we never push a slot that was fine, so the displaced block goes after it - with a breather, because landing flush against our own session is the same problem as landing flush against a meeting.",
    tags: ["cascade", "breather"],
    activities: [deepWork, eyeRest],
    events: [{ id: "m1", title: "Board", start: "14:00", end: "14:30" }],
    slots: [
      { id: "s1", activityId: "deep-work", start: "10:00" },
      { id: "s2", activityId: "eye-rest", start: "11:00" },
    ],
    changes: [{ op: "resize", eventId: "m1", start: "09:30", end: "11:00" }],
    expect: {
      suggested: [["s1", "11:15", ["large_drift"]]],
    },
  },

  /* ── E. Lifecycle ──────────────────────────────────────────────────────── */
  {
    id: "e2-running-slot-conflicted",
    title: "A session in progress is buried",
    probes:
      "It is happening now. A meeting that lands on it does not get to interrupt it - if the user wants it later they can drag it.",
    tags: ["lifecycle", "frozen"],
    activities: [deepWork],
    now: "09:20",
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [
      { id: "s1", activityId: "deep-work", start: "09:00", status: "started" },
    ],
    changes: [{ op: "move", eventId: "m1", to: "09:15" }],
    expect: {
      frozen: ["s1"],
    },
  },
  {
    id: "e3-healthy-slot-holds-the-only-gap",
    title: "The only free space is under a slot that is fine",
    probes:
      "The healthy slot still fits its gap, so it stays and the displaced one goes to the bucket. Blocked beats a bad suggestion.",
    tags: ["lifecycle", "blocked"],
    activities: [deepWork, morningStretch],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:30" },
      { id: "m2", title: "Afternoon", start: "11:00", end: "18:00" },
    ],
    slots: [
      { id: "s1", activityId: "stretch", start: "09:30" },
      { id: "s2", activityId: "deep-work", start: "09:45", end: "11:00" },
    ],
    changes: [{ op: "resize", eventId: "m1", end: "09:45" }],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
  {
    id: "e4-completed-slot-untouched",
    title: "A finished session gets a meeting on top of it",
    probes:
      "Already done. Nothing to repair, and it must not appear in any bucket.",
    tags: ["lifecycle", "no-op"],
    activities: [deepWork],
    now: "11:00",
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [
      {
        id: "s1",
        activityId: "deep-work",
        start: "09:00",
        status: "completed",
      },
    ],
    changes: [{ op: "move", eventId: "m1", to: "09:10" }],
    expect: {},
  },
  {
    id: "e5-cancelled-slot-frees-its-space",
    title: "A cancelled session leaves a hole in the afternoon",
    probes:
      "Cancelled is the one not-happening status that can still sit in the future - skipped and missed are past tense by definition. Its time is free, and the repair may use it.",
    tags: ["lifecycle"],
    activities: [deepWork, morningStretch],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:30" },
      { id: "m2", title: "Afternoon", start: "11:00", end: "18:00" },
    ],
    slots: [
      { id: "s1", activityId: "stretch", start: "09:30" },
      {
        id: "s2",
        activityId: "deep-work",
        start: "09:45",
        end: "11:00",
        status: "cancelled",
      },
    ],
    changes: [{ op: "resize", eventId: "m1", end: "09:45" }],
    expect: {
      moved: [["s1", "09:55"]],
    },
  },
  {
    id: "e6-slot-in-the-past-ignored",
    title: "A conflict lands on a slot that already passed",
    probes:
      "Someone moved a meeting onto this morning at four in the afternoon. History is not repairable.",
    tags: ["lifecycle", "no-op"],
    activities: [deepWork],
    now: "16:00",
    events: [{ id: "m1", title: "Call", start: "17:00", end: "17:30" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:00" }],
    expect: {},
  },
  {
    id: "e7-slot-straddling-now",
    title: "The conflicted slot has already started by the clock",
    probes:
      "Status still says planned but the clock says otherwise. We treat the clock as the truth and leave it.",
    tags: ["lifecycle", "frozen"],
    activities: [deepWork],
    now: "10:20",
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:15" }],
    expect: {
      frozen: ["s1"],
    },
  },

  /* ── F. Boundaries ─────────────────────────────────────────────────────── */
  {
    id: "f1-only-room-is-after-the-day-ends",
    title: "The only space is past the end of the day",
    probes: "18:30 is not a repair. The day's end is a wall.",
    tags: ["bounds", "blocked"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Marathon", start: "10:00", end: "18:00" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:30" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:30" }],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
  {
    id: "f2-space-is-partly-in-the-past",
    title: "The gap starts before now",
    probes:
      "A repair at 08:30 when it is already 09:00 is not a repair. Placement starts at now, not at the day.",
    tags: ["bounds"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Late morning", start: "10:00", end: "12:00" },
      { id: "m2", title: "Afternoon", start: "12:00", end: "17:00" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:15" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:50" }],
    expect: {
      suggested: [["s1", "09:00", ["large_drift"]]],
    },
  },
  {
    id: "f3-day-nearly-over",
    title: "Half an hour of day left, fifty minutes of work",
    probes: "Cannot fit before the wall. Bucket, with the honest reason.",
    tags: ["bounds", "blocked"],
    activities: [deepWork],
    now: "17:30",
    events: [{ id: "m1", title: "Call", start: "16:00", end: "16:30" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "17:35" }],
    changes: [{ op: "resize", eventId: "m1", start: "17:30", end: "17:50" }],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
  {
    id: "f4-slot-outlives-a-shortened-day",
    title: "A slot sits past the end of a day the user shortened",
    probes:
      "The clock is past the day's end and the slot is still ahead of it. There is nowhere legal to put it and no point pretending otherwise, so the bucket says the day is over rather than blaming a missing gap.",
    tags: ["bounds", "blocked"],
    activities: [deepWork],
    now: "18:30",
    events: [{ id: "m1", title: "Evening call", start: "20:00", end: "20:30" }],
    slots: [
      { id: "s1", activityId: "deep-work", start: "18:40", end: "19:30" },
    ],
    changes: [{ op: "move", eventId: "m1", to: "18:50" }],
    expect: {
      blocked: [["s1", "day_over"]],
    },
  },
  {
    id: "f5-change-lands-on-a-future-day",
    title: "A meeting moves on a day that has not started",
    probes:
      "Not today. The whole day is placeable, not just the part after the clock, so the repair may use the morning.",
    tags: ["bounds", "future"],
    activities: [deepWork],
    // Before the day starts, which is what a future day looks like once the
    // caller has resolved it.
    now: "06:00",
    events: [{ id: "m1", title: "Offsite", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:50", end: "13:30" }],
    expect: {
      suggested: [["s1", "08:50", ["large_drift"]]],
    },
  },
  {
    id: "f6-dst-spring-forward",
    title: "The morning the clocks go forward",
    probes:
      "01:00 to 02:00 does not exist in London on this date. Windows resolved across the skip must still bound the same real time.",
    tags: ["dst", "window"],
    timeZone: "Europe/London",
    date: { year: 2026, month: 3, day: 29 },
    now: "00:15",
    day: ["00:00", "10:00"],
    activities: [
      {
        id: "stretch",
        name: "Early stretch",
        kind: "recovery",
        sessionMinutes: 15,
        windows: [["00:30", "04:00"]],
      },
    ],
    events: [{ id: "m1", title: "Red eye", start: "05:00", end: "06:00" }],
    slots: [{ id: "s1", activityId: "stretch", start: "00:45" }],
    changes: [{ op: "move", eventId: "m1", to: "00:45" }],
    expect: {
      moved: [["s1", "00:30"]],
    },
  },

  /* ── G. What counts as busy ────────────────────────────────────────────── */
  {
    id: "g1-all-day-event-added",
    title: "An all-day event appears over the whole day",
    probes:
      "We cannot tell a birthday from a blocked-out day, and guessing wrong schedules a session inside something real. If the day is covered, the day is covered.",
    tags: ["busy", "blocked"],
    activities: [deepWork, eyeRest],
    events: [],
    // Two slots, so the bucket has to carry more than one entry.
    slots: [
      { id: "s1", activityId: "deep-work", start: "10:00" },
      { id: "s2", activityId: "eye-rest", start: "15:00" },
    ],
    changes: [
      {
        op: "add",
        event: {
          id: "m9",
          title: "Sam's birthday",
          start: "00:00",
          end: "23:59",
          isAllDay: true,
          kind: "birthday",
        },
      },
    ],
    expect: {
      blocked: [
        ["s1", "no_gap"],
        ["s2", "no_gap"],
      ],
    },
  },
  {
    id: "g3-declined-meeting-moved-onto-slot",
    title: "A declined meeting is dragged onto a slot",
    probes:
      "One of the two that genuinely left the calendar. Declined is not the user's time, so nothing moves.",
    tags: ["busy", "no-op"],
    activities: [deepWork],
    events: [
      {
        id: "m1",
        title: "Optional sync",
        start: "13:00",
        end: "13:30",
        responseStatus: "declined",
      },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:00" }],
    expect: {},
  },
  {
    id: "g4-tentative-meeting-moved-onto-slot",
    title: "A tentative meeting lands on a slot",
    probes:
      "Still on the calendar, so still the user's time. We plan around it.",
    tags: ["busy"],
    activities: [deepWork],
    events: [
      {
        id: "m1",
        title: "Maybe",
        start: "13:00",
        end: "13:30",
        busyStatus: "tentative",
      },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:00" }],
    expect: {
      moved: [["s1", "10:35"]],
    },
  },
  {
    id: "g5-same-meeting-on-two-calendars",
    title: "The same meeting on a work and a personal calendar",
    probes:
      "One iCalUID, two rows. It must count once, or the busy set doubles and the repair over-reacts.",
    tags: ["busy", "dedupe"],
    activities: [deepWork],
    events: [
      {
        id: "m1",
        title: "Board",
        start: "13:00",
        end: "13:30",
        calendarId: "work",
        icalUid: "uid-board",
      },
      {
        id: "m2",
        title: "Board",
        start: "13:00",
        end: "13:30",
        calendarId: "personal",
        icalUid: "uid-board",
      },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [
      { op: "move", eventId: "m1", to: "10:00" },
      { op: "move", eventId: "m2", to: "10:00" },
    ],
    expect: {
      moved: [["s1", "10:35"]],
    },
  },
  {
    id: "g6-event-cancelled-in-place",
    title: "The meeting on the slot is cancelled but still synced",
    probes:
      "The other one that left the calendar. A cancelled row is still a row, and it must stop being busy - the slot stays exactly where it was.",
    tags: ["busy", "no-op"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Call", start: "10:00", end: "10:50" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "patch", eventId: "m1", patch: { isCancelled: true } }],
    expect: {},
  },
  {
    id: "g7-working-location-spans-the-day",
    title: "A working-location event covers the workday",
    probes:
      "Google calls it metadata; Graph has no equivalent, so the same entry from Outlook is indistinguishable from a real all-day block. Treated as the full-day event it looks like.",
    tags: ["busy", "blocked"],
    activities: [deepWork],
    events: [],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [
      {
        op: "add",
        event: {
          id: "m9",
          title: "Office",
          start: "08:00",
          end: "18:00",
          kind: "workingLocation",
        },
      },
    ],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
  {
    id: "g8-meeting-marked-free",
    title: "A meeting is switched to 'free'",
    probes:
      "It still shows on the calendar as an hour that is spoken for. `transparency` is a hint about attendance, not a promise the user is available.",
    tags: ["busy"],
    activities: [deepWork],
    events: [{ id: "m1", title: "FYI", start: "13:00", end: "13:50" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [
      { op: "move", eventId: "m1", to: "10:00" },
      { op: "patch", eventId: "m1", patch: { busyStatus: "free" } },
    ],
    expect: {
      moved: [["s1", "09:00"]],
    },
  },
  {
    id: "g9-zero-length-event",
    title: "A zero-length event lands on a slot",
    probes:
      "Providers do emit these. A block with no duration takes no time, whatever the literal reading says.",
    tags: ["busy", "malformed", "no-op"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Marker", start: "13:00", end: "13:00" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "move", eventId: "m1", to: "10:15" }],
    expect: {},
  },

  /* ── H. Breathers ──────────────────────────────────────────────────────── */
  {
    id: "h1-breather-after-a-long-meeting",
    title: "Repair lands after a two-hour call",
    probes:
      "Ten minutes, because the meeting was long. A session that starts the second a long call ends is a session nobody does.",
    tags: ["breather"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "12:00" },
      { id: "m2", title: "Quarterly", start: "12:00", end: "14:00" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "13:30" }],
    changes: [{ op: "resize", eventId: "m2", end: "14:00" }],
    expect: {
      moved: [["s1", "14:10"]],
    },
  },
  {
    id: "h2-breather-after-a-short-meeting",
    title: "Repair lands after a half-hour stand-up",
    probes: "Five minutes. A short meeting earns a shorter breather.",
    tags: ["breather"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "11:30" },
      { id: "m2", title: "Standup", start: "12:00", end: "12:30" },
    ],
    // Standing clear of the morning, so the breather is sized off the
    // stand-up rather than off a merged run of back-to-back meetings.
    slots: [{ id: "s1", activityId: "deep-work", start: "12:10" }],
    changes: [{ op: "resize", eventId: "m2", end: "12:30" }],
    expect: {
      moved: [["s1", "12:35"]],
    },
  },
  {
    id: "h3-no-room-for-a-breather",
    title: "The gap is exactly the length of the session",
    probes:
      "A tight fit beats no session. The breather is a preference, and this is where it has to give way.",
    tags: ["breather", "tight"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:20" },
      { id: "m2", title: "Rest of day", start: "10:20", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "09:25" }],
    changes: [{ op: "resize", eventId: "m1", end: "09:30" }],
    expect: {
      moved: [["s1", "09:30"]],
    },
  },
  {
    id: "h4-breather-before-a-meeting",
    title: "Repair lands just before a long meeting",
    probes:
      "The other side. Being pushed into a meeting is the same problem as being pushed out of one.",
    tags: ["breather"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:05" },
      { id: "m2", title: "Rest", start: "11:00", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:05" }],
    changes: [{ op: "resize", eventId: "m2", start: "10:30" }],
    expect: {
      moved: [["s1", "09:30"]],
    },
  },
  {
    id: "h5-configured-buffer-raises-the-floor",
    title: "The activity asks for twenty minutes before any meeting",
    probes:
      "`bufferBeforeMeetingMinutes` is the user asking for more room than the default. It raises the floor and never lowers it - but it is still a preference, not a wall.",
    tags: ["breather", "config"],
    activities: [
      {
        id: "breathe",
        name: "Breathing",
        kind: "recovery",
        sessionMinutes: 25,
        bufferBeforeMeetingMinutes: 20,
      },
    ],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:00" },
      { id: "m2", title: "Rest of day", start: "11:00", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "breathe", start: "09:05" }],
    changes: [{ op: "resize", eventId: "m1", end: "09:30" }],
    expect: {
      moved: [["s1", "09:40"]],
    },
  },
  {
    id: "h6-breather-is-not-worth-crossing-the-day",
    title: "A breather is available, but hours away",
    probes:
      "The cost, priced. Ten minutes of missing breather is worth twenty minutes of drift, not five hours - so the tight fit close to home wins.",
    tags: ["breather", "cost"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:50" },
      { id: "m2", title: "Middle", start: "10:50", end: "15:00" },
    ],
    // The far side of `m2` is wide open and would give a full breather. It is
    // five hours away, and the tight fit at 10:00 wins anyway.
    slots: [{ id: "s1", activityId: "deep-work", start: "09:55" }],
    changes: [{ op: "resize", eventId: "m1", end: "10:00" }],
    expect: {
      moved: [["s1", "10:00"]],
    },
  },

  {
    id: "h7-gap-rule-turned-off",
    title: "The same day with the gap rule switched off",
    probes:
      "`h2` with `NO_BREATHER`. Nothing wants room any more, so the repair takes the first minute it can and the slot sits flush against the stand-up.",
    tags: ["breather", "config"],
    breather: NO_BREATHER,
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "11:30" },
      { id: "m2", title: "Standup", start: "12:00", end: "12:30" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "12:10" }],
    changes: [{ op: "resize", eventId: "m2", end: "12:30" }],
    expect: {
      moved: [["s1", "12:30"]],
    },
  },
  {
    id: "h8-bigger-gap-configured",
    title: "The same day with a quarter-hour asked for",
    probes:
      "`h2` again, with the gap set to fifteen minutes. The third answer from one situation - which is the whole point of the setting being a number rather than a constant.",
    tags: ["breather", "config"],
    breather: { minutes: 15, longMinutes: 25 },
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "11:30" },
      { id: "m2", title: "Standup", start: "12:00", end: "12:30" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "12:10" }],
    changes: [{ op: "resize", eventId: "m2", end: "12:30" }],
    expect: {
      moved: [["s1", "12:45"]],
    },
  },
  {
    id: "h9-activity-buffer-outlives-the-setting",
    title: "Gap rule off, but this activity still wants twenty minutes",
    probes:
      "The two are not the same switch. A global preference for a packed day must not quietly cancel the room the user asked for on one particular activity - so the session is still pulled clear of the meeting.",
    tags: ["breather", "config"],
    breather: NO_BREATHER,
    activities: [
      {
        id: "breathe",
        name: "Breathing",
        kind: "recovery",
        sessionMinutes: 25,
        bufferBeforeMeetingMinutes: 20,
      },
    ],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:30" },
      { id: "m2", title: "Afternoon", start: "10:30", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "breathe", start: "10:05" }],
    changes: [{ op: "resize", eventId: "m2", start: "10:20" }],
    expect: {
      moved: [["s1", "09:35"]],
    },
  },

  /* ── I. Drift ──────────────────────────────────────────────────────────── */
  {
    id: "i1-large-drift-with-no-window",
    title: "An anytime block pushed six hours",
    probes:
      "No window to break, but 10:00 becoming late afternoon is a different plan. We ask.",
    tags: ["drift", "suggest"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Workshop", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:30", end: "16:30" }],
    expect: {
      suggested: [["s1", "16:40", ["large_drift"]]],
    },
  },
  {
    id: "i2-drift-exactly-on-the-hour",
    title: "Pushed exactly sixty minutes",
    probes:
      "The boundary itself, breather included. On the line is still a repair.",
    tags: ["drift", "auto", "boundary"],
    activities: [deepWork],
    events: [
      { id: "m0", title: "Morning", start: "08:00", end: "10:00" },
      { id: "m1", title: "Call", start: "13:00", end: "13:30" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:55", end: "10:50" }],
    expect: {
      moved: [["s1", "11:00"]],
    },
  },
  {
    id: "i3-drift-one-minute-past-the-hour",
    title: "Pushed sixty-one minutes",
    probes: "One minute the other side. Now it is a question.",
    tags: ["drift", "suggest", "boundary"],
    activities: [deepWork],
    events: [
      { id: "m0", title: "Morning", start: "08:00", end: "10:00" },
      { id: "m1", title: "Call", start: "13:00", end: "13:30" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:55", end: "10:51" }],
    expect: {
      suggested: [["s1", "11:01", ["large_drift"]]],
    },
  },
  {
    id: "i4-slot-moves-earlier",
    title: "The repair lands earlier than the original",
    probes:
      "Drift is a distance, not a direction. A slot pulled forward can be just as surprising.",
    tags: ["drift"],
    activities: [deepWork],
    events: [
      { id: "m1", title: "Morning", start: "08:00", end: "09:05" },
      { id: "m2", title: "Rest", start: "11:00", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:05" }],
    changes: [{ op: "resize", eventId: "m2", start: "10:30" }],
    expect: {
      moved: [["s1", "09:30"]],
    },
  },
  {
    id: "i5-window-beats-drift",
    title: "A windowed activity pushed a long way inside its window",
    probes:
      "Distance is the fallback rule, not an extra one. An activity that has already said where it belongs does not also get asked how far it travelled to get there.",
    tags: ["drift", "window", "auto"],
    activities: [morningStretch],
    events: [
      { id: "m1", title: "Morning", start: "09:15", end: "09:30" },
      { id: "m2", title: "Rest", start: "13:00", end: "18:00" },
    ],
    slots: [{ id: "s1", activityId: "stretch", start: "09:20" }],
    changes: [{ op: "resize", eventId: "m1", start: "09:00", end: "11:20" }],
    expect: {
      moved: [["s1", "11:30"]],
    },
  },

  /* ── J. Malformed and defensive ────────────────────────────────────────── */
  {
    id: "j1-slot-with-no-activity",
    title: "A slot whose activity we know nothing about",
    probes:
      "An archived activity, or a race between a sync and a delete. With no rules to reason with, the only safe move is none.",
    tags: ["malformed", "no-op"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "vanished", start: "10:00", end: "10:50" }],
    changes: [{ op: "move", eventId: "m1", to: "10:00" }],
    expect: {},
  },
  {
    id: "j2-meeting-covers-the-entire-day",
    title: "One meeting from the first minute to the last",
    probes:
      "No gaps at all, not even a zero-length one. The search must come back empty rather than divide the day by nothing.",
    tags: ["malformed", "blocked"],
    activities: [deepWork],
    events: [{ id: "m1", title: "Conference", start: "12:00", end: "18:00" }],
    slots: [{ id: "s1", activityId: "deep-work", start: "10:00" }],
    changes: [{ op: "resize", eventId: "m1", start: "08:00" }],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
  {
    id: "j3-slot-longer-than-the-day",
    title: "A slot longer than the working day",
    probes:
      "Nothing can hold it. Bucketed for the right reason rather than looping looking for space that cannot exist.",
    tags: ["malformed", "blocked"],
    activities: [
      {
        id: "marathon",
        name: "Marathon session",
        kind: "focus",
        sessionMinutes: 720,
      },
    ],
    events: [{ id: "m1", title: "Call", start: "13:00", end: "13:30" }],
    slots: [{ id: "s1", activityId: "marathon", start: "09:00", end: "21:00" }],
    changes: [{ op: "move", eventId: "m1", to: "09:30" }],
    expect: {
      blocked: [["s1", "no_gap"]],
    },
  },
];

export const scenarioById = (id: string): Scenario | undefined =>
  SCENARIOS.find((s) => s.id === id);
