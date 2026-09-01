/**
 * The day, where anything outside the Today page can read it.
 *
 * The rail is rendered by the shell, not by the page - a route declares a
 * component and the shell mounts it, with no way to hand it props. So the
 * modules in the rail cannot be given the plan the page just fetched, and
 * fetching it a second time would mean two round trips per reload, two answers
 * that can disagree, and a rail that ticks over a beat after the timeline.
 *
 * One writer, many readers. Today publishes what it loaded; the rail reads it.
 * Nothing here fetches anything, which is what keeps the page the single place
 * that decides when the day is re-read.
 *
 * The same `useSyncExternalStore` shape as `lib/notify` and `lib/density`,
 * because React ships it for exactly this and a store this small does not earn
 * a library.
 */

import { useSyncExternalStore } from "react";
import type { TodayResponse } from "./api";

let plan: TodayResponse | null = null;
/**
 * The last plan that was actually about today, kept alongside the one on
 * screen.
 *
 * The two used to be the same thing, which was true right up until the day
 * view learned to page forward. The menu bar and the notifications are
 * properties of *today* - "up next" means next today, and an alert for a slot
 * three days out is not an alert - so they cannot read the day someone happens
 * to be looking at. Nor can they go blank while they look: the menu bar is the
 * one thing that answers "what now" without switching apps, and it has to keep
 * answering while you read next week.
 */
let todayPlan: TodayResponse | null = null;
const listeners = new Set<() => void>();

/**
 * Whether a plan is about the day it is being read on.
 *
 * By date in the plan's own zone, not by its bounds. `dayStart`/`dayEnd` are
 * the *visible range* - 08:00 to 18:00, say - so a bounds test calls today's
 * plan stale at seven in the evening, which is exactly when someone most wants
 * to know what is left.
 */
export const isToday = (candidate: TodayResponse, now: number): boolean => {
  const here = new Intl.DateTimeFormat("en-CA", {
    timeZone: candidate.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const { year, month, day } = candidate.date;
  return (
    here ===
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
};

/**
 * Starting a slot, as Today does it.
 *
 * Here rather than called directly by the rail because `api.startSlot` is only
 * half of it: the press also has to reach the page's own queue count and make
 * it reload. A rail that called the API itself would start the slot and leave
 * the timeline next to it still drawing the old status.
 *
 * A no-op before Today has mounted, which is the only time the rail can exist
 * without it - and pressing a button in a module that has no day behind it is
 * not a case worth a guard at every call site.
 */
let start: (slotId: string) => void = () => undefined;

/** Called by Today whenever it has a new answer. */
export function publishPlan(
  next: TodayResponse | null,
  now: number = Date.now(),
): void {
  plan = next;
  /**
   * Only ever replaced by another plan for today - never cleared by one for
   * another day. Paging forward is looking, and looking must not cost the menu
   * bar the day it is reporting on.
   *
   * But a day ends. Held with no expiry, the plan that *was* today went on
   * being today's plan after midnight, so the menu bar kept being armed from a
   * day that had finished - naming slots nobody could still do anything about,
   * on a day whose own slots had not been placed yet. Yesterday's plan is not
   * "no plan for today", and the difference is the whole bug: the first says
   * something is coming, the second says nothing is.
   */
  if (todayPlan && !isToday(todayPlan, now)) todayPlan = null;
  if (next && isToday(next, now)) todayPlan = next;
  for (const listen of listeners) listen();
}

export function publishStart(fn: (slotId: string) => void): void {
  start = fn;
}

export const startSlot = (slotId: string): void => start(slotId);

/**
 * Moving a slot, as Today does it.
 *
 * Here for the same reason as `start`, and one more: Today's move is
 * optimistic, so the block is redrawn where it is going before the server has
 * answered. A rail that called `api.moveSlot` itself would read the slot's
 * time out of a plan that has not caught up yet, and two nudges in quick
 * succession would land on the same minute.
 */
let move: (slotId: string, startsAt: number, endsAt: number) => void = () =>
  undefined;

export function publishMove(
  fn: (slotId: string, startsAt: number, endsAt: number) => void,
): void {
  move = fn;
}

export const moveSlotTo = (
  slotId: string,
  startsAt: number,
  endsAt: number,
): void => move(slotId, startsAt, endsAt);

/**
 * Re-read the day.
 *
 * Same reason as `start`: a rail module that changed the day has to make the
 * timeline beside it agree, and only Today knows which range is on screen and
 * how to ask for it again.
 */
let reload: () => void = () => undefined;

export function publishReload(fn: () => void): void {
  reload = fn;
}

export const reloadPlan = (): void => reload();

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

const snapshot = (): TodayResponse | null => plan;

/** The day as Today last saw it, or null before the first load. The server
 *  snapshot is null too: nothing has been fetched during a render. */
export const usePlan = (): TodayResponse | null =>
  useSyncExternalStore(subscribe, snapshot, () => null);

/** Today's plan, read outside React - which is where the menu bar's own
 *  bookkeeping and every test of it live. */
export const todaySnapshot = (): TodayResponse | null => todayPlan;

/**
 * Today's plan, whatever day is on screen.
 *
 * What the menu bar and the notifications read. Distinct from `usePlan` on
 * purpose: that one answers "what am I looking at", this one answers "what is
 * happening", and after the day view learned to page forward those stopped
 * being the same question.
 */
export const useTodayPlan = (): TodayResponse | null =>
  useSyncExternalStore(subscribe, todaySnapshot, () => null);

/** Test seam. Module state has to outlive every page, which means a test
 *  needs a way to start from nothing. */
export function resetPlans(): void {
  plan = null;
  todayPlan = null;
}
