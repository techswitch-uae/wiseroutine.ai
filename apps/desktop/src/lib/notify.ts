import type { ToastMessage } from "@wiseroutine/design";
import { useSyncExternalStore } from "react";

/**
 * Telling the user something did not happen.
 *
 * Settings that commit on click have no button left to report through: the
 * toggle has already moved, the request fails a moment later, and without this
 * the only sign is the switch quietly moving back. So there is one way to say
 * so from anywhere - `notify(text)` - and one place it appears, rendered by
 * the app shell.
 *
 * Deliberately in-app rather than an OS notification. A system notification
 * for "couldn't save that" arrives outside the window the user is looking at,
 * needs a permission they have to grant first, and is dropped without trace by
 * Do Not Disturb - which is the worst possible failure mode for a message that
 * exists to report a failure. Reach for the OS when the app is *not* in front
 * of the user (a slot starting, a session ending); not for this.
 *
 * The same shape as `lib/account`: `useSyncExternalStore` and three functions,
 * because React ships it for exactly this and a store this small does not earn
 * a library.
 */

/** Long enough to read a sentence, short enough not to sit there. */
const DISMISS_MS = 6_000;

let items: readonly ToastMessage[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish(next: readonly ToastMessage[]): void {
  items = next;
  for (const listen of listeners) listen();
}

/**
 * Say that something failed.
 *
 * Repeats collapse: a sync retrying three times is one problem, and three
 * identical messages stacked up read as three. The timer restarts instead, so
 * the message stays for as long as the problem keeps happening.
 */
export function notify(text: string): void {
  const existing = items.find((item) => item.text === text);
  const id = existing?.id ?? crypto.randomUUID();
  if (!existing) publish([...items, { id, text }]);

  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => dismiss(id), DISMISS_MS),
  );
}

export function dismiss(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  publish(items.filter((item) => item.id !== id));
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

const snapshot = (): readonly ToastMessage[] => items;

/** The same snapshot serves the server render: nothing has failed there. */
export const useToasts = (): readonly ToastMessage[] =>
  useSyncExternalStore(subscribe, snapshot, snapshot);
