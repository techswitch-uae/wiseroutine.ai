import { useSyncExternalStore } from "react";
import {
  accountStorageKey,
  onSessionReset,
  sessionIdentity,
  useSessionIdentity,
} from "./session-lifecycle";

export type DayRangeChoice = "working" | "full" | "custom";
const KEY = "wiseroutine.day.range";
const choices = new Map<string, DayRangeChoice | null>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const valid = (value: string | null): value is DayRangeChoice =>
  value === "working" || value === "full" || value === "custom";

onSessionReset(() => {
  choices.clear();
  notify();
});

/** A device-local view choice, not scheduling hours or a release permission.
 * Null defers to the existing default; an unidentified session inherits nothing. */
export function getDayRange(): DayRangeChoice | null {
  if (!sessionIdentity()) return null;
  const key = accountStorageKey(KEY);
  if (!choices.has(key)) {
    let value: string | null = null;
    try {
      value = globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      // Unavailable storage must never prevent the day from opening.
    }
    choices.set(key, valid(value) ? value : null);
  }
  return choices.get(key) ?? null;
}

/** Only explicit view changes write storage; server fallback never overwrites
 * a saved custom view when it is temporarily unavailable. */
export function setDayRange(value: string | null): void {
  if (!sessionIdentity() || (value !== null && !valid(value))) return;
  const key = accountStorageKey(KEY);
  choices.set(key, value);
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Still remembered across navigation in this session if storage is blocked.
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDayRange(): DayRangeChoice | null {
  // Identity can arrive after Today mounts, or change while it stays mounted.
  useSessionIdentity();
  return useSyncExternalStore(subscribe, getDayRange, () => null);
}
