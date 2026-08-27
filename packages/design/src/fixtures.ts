import type { TodaySlotFixture } from "./screens";

/**
 * Sample data for the collection.
 *
 * Separate from the screens so the gallery, a test and the app can read one
 * source — and so the screen modules stay components only.
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
