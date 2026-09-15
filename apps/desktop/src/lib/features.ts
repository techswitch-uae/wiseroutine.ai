import {
  CORE_FEATURES,
  type FeatureFlags,
  parseFeatureOverrides,
  resolveFeatures,
} from "@wiseroutine/plans/features";
import { useSyncExternalStore } from "react";
import {
  onSessionReset,
  sessionGeneration,
  sessionToken,
} from "./session-lifecycle";

let flags: FeatureFlags = CORE_FEATURES;
let sequence = 0;
let verifiedAt = -Infinity;
export const FEATURE_LEASE_MS = 5 * 60_000;
const listeners = new Set<() => void>();
export const featureSnapshot = () => flags;
export function subscribeFeatures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: FeatureFlags): void {
  if (JSON.stringify(flags) === JSON.stringify(next)) return;
  flags = next;
  for (const listener of listeners) listener();
}
onSessionReset(() => {
  sequence++;
  verifiedAt = -Infinity;
  publish(CORE_FEATURES);
});
export const useFeatures = () =>
  useSyncExternalStore(subscribeFeatures, featureSnapshot, () => CORE_FEATURES);

/** Server-authoritative and memory-only: localStorage/query parameters cannot
 * unlock a public feature. A short offline lease preserves open drafts during
 * network loss; it cannot grant new access or survive a process/account change.
 * Explicit server-off/invalid responses still hide the feature immediately. */
export async function loadFeatures(): Promise<void> {
  const generation = sessionGeneration();
  const order = ++sequence;
  let next = CORE_FEATURES;
  let nextVerifiedAt = -Infinity;
  try {
    if (sessionToken()) {
      const { api } = await import("./api");
      const response = await api.features();
      next = resolveFeatures(parseFeatureOverrides(response.features));
      nextVerifiedAt = performance.now();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "OfflineError" &&
      performance.now() - verifiedAt < FEATURE_LEASE_MS
    ) {
      next = flags;
      nextVerifiedAt = verifiedAt; // Failed refresh never extends authority.
    }
  }
  if (generation === sessionGeneration() && order === sequence) {
    verifiedAt = nextVerifiedAt;
    publish(next);
  }
}
export function watchFeatures(): () => void {
  const refresh = () => {
    void loadFeatures();
  };
  refresh();
  const timer = setInterval(refresh, 30_000);
  globalThis.addEventListener("focus", refresh);
  globalThis.addEventListener("online", refresh);
  return () => {
    sequence++;
    clearInterval(timer);
    globalThis.removeEventListener("focus", refresh);
    globalThis.removeEventListener("online", refresh);
  };
}
