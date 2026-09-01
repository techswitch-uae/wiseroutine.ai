/**
 * A session on its way onto the day, before there is a slot for it.
 *
 * Here for the same reason the picked block is - see `lib/picked`. The rail is
 * mounted by the shell and the timeline by the page, so the module doing the
 * dragging cannot hand the grid anything: `ToPlace` writes where the cursor is
 * and what it would place, and Today reads it back and draws the block the
 * drop would produce.
 *
 * It is deliberately the *drag*, not the placement. Nothing here writes
 * anything - `ToPlace` still owns the pointer and the request - so a window
 * that never sees a drop simply forgets it.
 */

import { useSyncExternalStore } from "react";

export interface Placement {
  /** The activity being placed, and what it is called on the day. */
  activityId: string;
  name: string;
  kind: "recovery" | "focus" | "task";
  minutes: number;
  /** Where it would land, or null while the cursor is off the day - which is
   *  what makes releasing there a cancel rather than a placement. */
  startsAt: number | null;
  /** The cursor, in client coordinates. The card follows it. */
  x: number;
  y: number;
}

/** The key the day's grid draws it under. Not an id from the server - there is
 *  nothing there yet - and never one a real slot could collide with. */
export const PLACING_KEY = "placing";

let placing: Placement | null = null;
const listeners = new Set<() => void>();

export function setPlacing(next: Placement | null): void {
  placing = next;
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

const snapshot = (): Placement | null => placing;

/** The drag in progress, or null. Null on the server snapshot too: nothing is
 *  being dragged during a render that has no pointer. */
export const usePlacing = (): Placement | null =>
  useSyncExternalStore(subscribe, snapshot, () => null);
