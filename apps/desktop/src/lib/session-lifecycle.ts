import { useSyncExternalStore } from "react";

const TOKEN = "wiseroutine.session";
const IDENTITY = "wiseroutine.identity";
let generation = 0;
let controller = new AbortController();
const resets = new Set<() => void>();
const listeners = new Set<() => void>();
const invalidations = new Set<() => void>();
export function invalidateServerState(): void {
  for (const listener of invalidations) listener();
}
export function onServerInvalidated(listener: () => void): () => void {
  invalidations.add(listener);
  return () => {
    invalidations.delete(listener);
  };
}
const get = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const put = (key: string, value: string | null) => {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* unavailable storage */
  }
};
let observedToken = get(TOKEN);
let observedIdentity = observedToken ? get(IDENTITY) : null;
// Persisted identity is usable on an offline cold start. A different session
// arriving from another tab must be verified here before mounting its screens.
let identity = observedIdentity;
function observeStorage(): void {
  const token = get(TOKEN);
  const storedIdentity = token ? get(IDENTITY) : null;
  if (token === observedToken && storedIdentity === observedIdentity) return;
  observedToken = token;
  observedIdentity = storedIdentity;
  identity = null;
  generation++;
  controller.abort();
  controller = new AbortController();
  for (const reset of resets) reset();
  for (const listener of listeners) listener();
}
// Storage events can arrive after a response resolves. Every request boundary
// also observes storage synchronously, so that delivery order is not a fence.
export const sessionToken = (): string | null => {
  observeStorage();
  return observedToken;
};
export const sessionGeneration = (): number => {
  observeStorage();
  return generation;
};
export const sessionSignal = (): AbortSignal => {
  observeStorage();
  return controller.signal;
};
export const sessionIdentity = (): string | null => {
  observeStorage();
  return identity;
};
globalThis.addEventListener?.("storage", (event) => {
  if (event.key === null || event.key === TOKEN || event.key === IDENTITY)
    observeStorage();
});
globalThis.addEventListener?.("focus", observeStorage);
export const onSessionReset = (reset: () => void): (() => void) => {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
};
export function changeSession(token: string | null): void {
  if (token === sessionToken()) return;
  put(TOKEN, token);
  put(IDENTITY, null);
  observeStorage();
}
export function identifySession(id: string): void {
  if (!sessionToken()) return;
  put(IDENTITY, id);
  observedIdentity = get(IDENTITY);
  identity = id;
  for (const listener of listeners) listener();
}
/** Legacy unscoped data cannot safely be assigned to whichever user signs in next. */
export const accountStorageKey = (key: string): string =>
  `wr.user.${encodeURIComponent(sessionIdentity() ?? "unidentified")}.${key}`;
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useSessionIdentity = (): string | null =>
  useSyncExternalStore(subscribe, sessionIdentity, () => null);
export const useSessionGeneration = (): number =>
  useSyncExternalStore(subscribe, sessionGeneration, () => 0);
export interface SessionScope {
  generation: number;
  token: string | null;
  identity: string | null;
}
export const captureSessionScope = (): SessionScope => ({
  generation: sessionGeneration(),
  token: sessionToken(),
  identity: sessionIdentity(),
});
/** Fence a whole workflow, including local-storage waits between requests. */
export function assertSessionScope(scope: SessionScope): void {
  if (
    scope.generation !== sessionGeneration() ||
    scope.token !== sessionToken() ||
    // Parallel bootstrap reads may identify this same token while a request
    // is in flight. That null → verified identity is not an account switch;
    // external identity changes still reset generation in observeStorage().
    (scope.identity !== null && scope.identity !== sessionIdentity())
  )
    throw new SessionChangedError();
}
export class SessionChangedError extends Error {
  constructor() {
    super("The session changed");
  }
}
