import { useSyncExternalStore } from "react";

const TOKEN = "wiseroutine.session";
const IDENTITY = "wiseroutine.identity";
let generation = 0;
let controller = new AbortController();
const resets = new Set<() => void>();
const listeners = new Set<() => void>();
const invalidations = new Set<() => void>();
export function invalidateServerState(): void { for (const listener of invalidations) listener(); }
export function onServerInvalidated(listener: () => void): () => void {
  invalidations.add(listener); return () => { invalidations.delete(listener); };
}
const get = (key: string): string | null => {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
};
const put = (key: string, value: string | null) => {
  try { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); } catch { /* unavailable storage */ }
};
export const sessionToken = (): string | null => get(TOKEN);
export const sessionGeneration = (): number => generation;
export const sessionSignal = (): AbortSignal => controller.signal;
export const sessionIdentity = (): string | null => sessionToken() ? get(IDENTITY) : null;
export const onSessionReset = (reset: () => void): (() => void) => {
  resets.add(reset); return () => { resets.delete(reset); };
};
export function changeSession(token: string | null): void {
  if (token === sessionToken()) return;
  generation++;
  controller.abort();
  controller = new AbortController();
  put(TOKEN, token);
  put(IDENTITY, null);
  for (const reset of resets) reset();
  for (const listener of listeners) listener();
}
export function identifySession(id: string): void {
  if (!sessionToken()) return;
  put(IDENTITY, id);
  for (const listener of listeners) listener();
}
/** Legacy unscoped data cannot safely be assigned to whichever user signs in next. */
export const accountStorageKey = (key: string): string =>
  `wr.user.${encodeURIComponent(sessionIdentity() ?? "unidentified")}.${key}`;
export const useSessionIdentity = (): string | null => useSyncExternalStore(
  (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  sessionIdentity, () => null,
);
export class SessionChangedError extends Error {
  constructor() { super("The session changed"); }
}
