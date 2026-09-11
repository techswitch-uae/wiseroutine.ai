import type { TodayResponse } from "./api";
import { accountStorageKey } from "./session-lifecycle";

const listeners = new Set<() => void>();
export function eventDetailsAllowed(): boolean {
  try { return globalThis.localStorage?.getItem(accountStorageKey("privacy")) !== "private"; } catch { return false; }
}
export function setEventDetailsAllowed(allowed: boolean): void {
  try { globalThis.localStorage?.setItem(accountStorageKey("privacy"), allowed ? "titles" : "private"); } catch { /* unavailable storage */ }
  if (!allowed) for (const listener of listeners) listener();
}
export function onPrivacyRestricted(listener: () => void): void { listeners.add(listener); }
export function redactPlan(plan: TodayResponse): TodayResponse {
  const redact = (meeting: TodayResponse["meetings"][number]) => ({ ...meeting, title: null, joinUrl: null, description: null });
  return { ...plan, meetings: plan.meetings.map(redact), outside: {
    before: plan.outside.before.map(redact), after: plan.outside.after.map(redact),
  } };
}
