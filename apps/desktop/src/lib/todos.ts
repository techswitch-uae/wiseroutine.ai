import { useSyncExternalStore } from "react";
import { api, openGaps, type TodayResponse, type Todo } from "./api";

/** A todo with no length gets this much. One keypress to change. */
export const DEFAULT_TODO_MINUTES = 15;

/** Now, rounded up to the five-minute grid the day is drawn on. */
export const snappedNow = (now: number): number =>
  Math.ceil(now / 300_000) * 300_000;

/**
 * Where something this long would go if placed right now: the start of the
 * first gap on the day that fits it, or null when none does. The same gaps
 * the "place here" rows are built from, so the two never disagree.
 */
export function fitsAt(
  minutes: number,
  plan: TodayResponse | null,
  now: number,
): number | null {
  if (!plan) return null;
  for (const gap of openGaps(plan, snappedNow(now), minutes)) {
    // A gap opens when a meeting ends, which is rarely on the grid. Start on
    // the next mark, and only if what is left still fits.
    const start = snappedNow(gap.startsAt);
    if (gap.endsAt - start >= minutes * 60_000) return start;
  }
  return null;
}

/**
 * The open todos, for everything that draws or places them.
 *
 * The same `useSyncExternalStore` shape as `lib/plan-store`, and for the same
 * reason: the Quick add dialog lists them, the addon host hands them to the
 * todo card, and both must agree the moment one is added or put on the day.
 * Two fetches of `/todos` would be two lists a keypress apart.
 *
 * Null until first read. An empty list is an answer; null is not having asked.
 */

let todos: readonly Todo[] | null = null;
const listeners = new Set<() => void>();

function publish(next: readonly Todo[] | null): void {
  todos = next;
  for (const listen of listeners) listen();
}

/** Re-read the list. Every write ends here - the server's list is the list. */
export function reloadTodos(): Promise<void> {
  return (
    api
      .todos()
      .then(publish)
      // A failed read is not an empty list. Whatever was last known stands.
      .catch(() => undefined)
  );
}

export function subscribeTodos(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

export const todosSnapshot = (): readonly Todo[] | null => todos;

export const useTodos = (): readonly Todo[] | null =>
  useSyncExternalStore(subscribeTodos, todosSnapshot, () => null);

export function resetTodos(): void {
  publish(null);
}
