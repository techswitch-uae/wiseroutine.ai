/**
 * Which block on the day is being looked at.
 *
 * One at a time, and it lives here for the same reason the plan does: the rail
 * is mounted by the shell, not by the page, so a module in it cannot be handed
 * what the timeline beside it just selected - see `lib/plan-store`.
 *
 * An id and not a slot. A slot object goes stale the moment the day is
 * re-read - moved, started, finished - and a rail describing the copy it was
 * handed would keep saying "starts at 11:00" about a block now sitting at
 * noon. The id is looked up in whatever plan is current, so there is one
 * answer rather than two that can drift apart.
 *
 * The same `useSyncExternalStore` shape as `lib/notify` and `lib/density`.
 */

import { useSyncExternalStore } from "react";

let picked: string | null = null;
const listeners = new Set<() => void>();

export function pick(slotId: string | null): void {
  if (picked === slotId) return;
  picked = slotId;
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

const snapshot = (): string | null => picked;

/** The picked slot's id, or null when nothing is. */
export const usePicked = (): string | null =>
  useSyncExternalStore(subscribe, snapshot, () => null);
