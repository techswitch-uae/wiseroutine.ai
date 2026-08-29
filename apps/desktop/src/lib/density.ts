import {
  type DayDensity,
  DEFAULT_DENSITY,
  densityOf,
} from "@wiseroutine/design";
import { useSyncExternalStore } from "react";

/**
 * How much room the day gives an hour, remembered between launches.
 *
 * A view preference, not account data: it belongs to the screen it is being
 * read on, and syncing it would mean a laptop deciding how a desktop's day is
 * drawn. `localStorage` is the whole store.
 *
 * `useSyncExternalStore` rather than a context, for the same reason
 * `lib/account.ts` uses it: two places read this - the menu that sets it and
 * the grid that draws from it - and neither owns the other. React ships this
 * for exactly that shape.
 */
const KEY = "wiseroutine.day.density";

/**
 * Read once at module load, then kept here.
 *
 * Not read from storage on every render: `useSyncExternalStore` requires a
 * snapshot that is referentially stable between changes, and one that parsed
 * storage each time would hand back a new object every time React looked,
 * which is an infinite re-render rather than a slow one.
 */
function read(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    // Private windows and locked-down profiles throw on access rather than
    // answering null. Forgetting the preference is the right failure - the day
    // still draws, at the default.
    return null;
  }
}

function write(key: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, key);
  } catch {
    // Then it lasts as long as the window does. Nothing else breaks.
  }
}

const stored = read();
let current: DayDensity = densityOf(stored);
const listeners = new Set<() => void>();

/**
 * Replace a stored key that is not a preset.
 *
 * `densityOf` already resolves it, so nothing was broken - but the bad value
 * would sit there being re-resolved on every launch, and `setDensity` could
 * never clear it: asked for the same dead key again it resolves to the default,
 * sees no change, and returns before writing. Normalising once at load is what
 * makes storage agree with what is on screen.
 *
 * Only when something was stored. A first run writes nothing, because nobody
 * has chosen anything yet.
 */
if (stored !== null && stored !== current.key) write(current.key);

/** `densityOf` is total, so anything storage returns lands on a real preset. */
export function setDensity(key: string): void {
  const next = densityOf(key);
  if (next.key === current.key) return;

  current = next;
  write(next.key);
  for (const notify of listeners) notify();
}

/** The density in force, outside React. */
export const getDensity = (): DayDensity => current;

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

const snapshot = (): DayDensity => current;

/**
 * The density in force, re-rendering when it changes.
 *
 * The server snapshot is the default rather than the stored value: the markup
 * is rendered before there is a `localStorage` to ask, and claiming otherwise
 * is a hydration mismatch on every load for anyone who has changed it.
 */
export function useDensity(): DayDensity {
  return useSyncExternalStore(subscribe, snapshot, () =>
    densityOf(DEFAULT_DENSITY),
  );
}
