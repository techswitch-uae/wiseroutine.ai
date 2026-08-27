import { useSyncExternalStore } from "react";

/**
 * The signed-in account, shared by the rail and the account page.
 *
 * Two screens show the same name and one of them can change it, so it cannot
 * belong to either: the rail loaded its copy once on mount and had no way to
 * learn that a save on another screen had made it stale.
 *
 * `useSyncExternalStore` rather than a context or a state library — React
 * ships it for exactly this shape of problem, and the whole store is one value
 * and three functions. It is deliberately not a cache: `setAccount` is called
 * by whoever just learned the truth from the server, and nothing here fetches.
 */
export interface Account {
  name: string;
  email: string;
  plan: string;
  /** IANA zone every preferred window is evaluated in. */
  timeZone: string;
  /** Only ever rendered when it is an `https:` URL — see `Avatar`. */
  avatarUrl: string | null;
}

let current: Account | null = null;
const listeners = new Set<() => void>();

export function setAccount(next: Account | null): void {
  current = next;
  for (const notify of listeners) notify();
}

/** Change what you know without having to restate the rest — a name save
 *  knows the new name and nothing else. A no-op when nobody is signed in. */
export function patchAccount(patch: Partial<Account>): void {
  if (current) setAccount({ ...current, ...patch });
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

const snapshot = (): Account | null => current;

/**
 * Read the account, re-rendering when it changes.
 *
 * The same `snapshot` serves the server render: there is no session during SSR,
 * so it is null there and the first client render fills it in.
 */
export const useAccount = (): Account | null =>
  useSyncExternalStore(subscribe, snapshot, snapshot);
