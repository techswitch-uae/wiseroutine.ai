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
const listeners = new Set<() => void>();

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
export function publishPlan(next: TodayResponse | null): void {
  plan = next;
  for (const listen of listeners) listen();
}

export function publishStart(fn: (slotId: string) => void): void {
  start = fn;
}

export const startSlot = (slotId: string): void => start(slotId);

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
