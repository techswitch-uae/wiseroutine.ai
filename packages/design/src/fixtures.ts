import type { ActivityTemplate, TodaySlotFixture } from "./screens";
import { EVERY_DAY } from "./time";

/**
 * Sample data for the collection.
 *
 * Separate from the screens so the gallery, a test and the app can read one
 * source - and so the screen modules stay components only.
 */
export const TODAY_FIXTURE: readonly TodaySlotFixture[] = [
  {
    variant: "focus",
    time: "09:30",
    name: "Deep work",
    meta: "25 min · Pricing page copy",
    done: true,
  },
  {
    variant: "meeting",
    time: "10:00",
    name: "Design review",
    meta: "Outlook · 60 min",
    source: "O",
  },
  {
    variant: "live",
    time: "11:00",
    name: "Back & shoulder stretch",
    meta: "10 min · seated 52 min · Outlook",
    autoMove: "Moves itself in 3 min if you don't start",
    grace: 0.7,
  },
  {
    variant: "recovery",
    time: "13:05",
    name: "Eye rest",
    meta: "5 min · before three calls",
  },
];

/**
 * What "add an activity" starts from.
 *
 * A palette, not data: nothing here exists until someone picks it and presses
 * Add. It used to be seeded into every new database, which gave a free account
 * six active activities against a limit of two and made "0 of 2 used" a lie
 * the first time anyone read it.
 *
 * Counts and lengths are the ones from the design. They are defaults, and the
 * form exists to change them.
 */
export const ACTIVITY_LIBRARY: readonly ActivityTemplate[] = [
  {
    key: "shoulder-stretch",
    name: "Shoulder stretch",
    kind: "recovery",
    sessionMinutes: 10,
    perDay: 3,
    days: EVERY_DAY,
    land: "any",
  },
  {
    key: "eye-rest",
    name: "Eye rest",
    kind: "recovery",
    sessionMinutes: 5,
    perDay: 4,
    days: EVERY_DAY,
    land: "any",
  },
  {
    key: "walk",
    name: "Walk",
    kind: "recovery",
    sessionMinutes: 15,
    perDay: 1,
    days: EVERY_DAY,
    land: "afternoon",
  },
  {
    key: "deep-work",
    name: "Deep work",
    kind: "focus",
    sessionMinutes: 25,
    perDay: 4,
    days: EVERY_DAY,
    land: "morning",
  },
  {
    key: "breathing",
    name: "Breathing",
    kind: "recovery",
    sessionMinutes: 3,
    perDay: 2,
    days: EVERY_DAY,
    land: "any",
  },
  {
    key: "water",
    name: "Water",
    kind: "recovery",
    sessionMinutes: 1,
    perDay: 6,
    days: EVERY_DAY,
    land: "any",
  },
];
