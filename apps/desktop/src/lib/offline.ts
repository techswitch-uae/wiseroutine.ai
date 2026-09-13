import type { TodayResponse } from "./api";
import { accountStorageKey } from "./session-lifecycle";

/**
 * Enough of the app to follow your routine with no connection.
 *
 * Not a local database and not a sync engine - the day's plan is a few
 * kilobytes of JSON and the actions taken against it are a short list. What it
 * buys is the case that actually happens: the plan was made this morning, you
 * are on a plane, and you want to start a focus block and tick it off.
 *
 * What it deliberately does *not* do is plan. Planning needs the calendar,
 * which needs the network. Offline you can follow the routine you already
 * have; you cannot get a new one.
 */

const PLAN_KEY = "wiseroutine.today";
const QUEUE_KEY = "wiseroutine.pending";

/** Old builds recorded no owner. Preserve this data for verified recovery,
 * but never silently attribute it to the next account on this device. */
export function hasLegacyPending(): boolean {
  try {
    const entries: unknown = JSON.parse(store()?.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(entries) && entries.length > 0;
  } catch {
    return false;
  }
}

export type PendingKind = "start" | "complete" | "skip";

export interface PendingAction {
  /** Client-side id, so a replay that half-succeeds does not repeat itself. */
  id: string;
  slotId: string;
  kind: PendingKind;
  /** When the user did it, not when we manage to send it. */
  at: number;
  reason?: string;
}

interface CachedPlan {
  data: TodayResponse;
  cachedAt: number;
}

const store = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

function read<T>(key: string): T | null {
  const raw = store()?.getItem(accountStorageKey(key));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A half-written or older-format entry is not worth recovering; the next
    // successful request replaces it.
    store()?.removeItem(accountStorageKey(key));
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    const storage = store();
    if (!storage) return false;
    storage.setItem(accountStorageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ── The plan ────────────────────────────────────────────────────────────── */

/**
 * Save the plan, but only ever today's.
 *
 * The day view can now be paged forward, and every one of those days comes
 * back through the same call. Saving one would overwrite the only plan that is
 * any use offline - and `cachedPlan` would then refuse it, correctly, leaving
 * someone who glanced at next Tuesday with no day at all when the network
 * went. Looking ahead is not a reason to forget where you are.
 */
export function cachePlan(data: TodayResponse, now: number): void {
  if (now < data.dayStart || now >= data.dayEnd) return;
  write(PLAN_KEY, { data, cachedAt: now } satisfies CachedPlan);
}

/**
 * The last plan we saw, if it is still about today.
 *
 * A plan cached yesterday is worse than nothing: it would show a routine
 * already spent, with times that have passed, and let someone tick off slots
 * that no longer exist. The day bounds it was built for are the check.
 */
export function cachedPlan(
  now: number,
): { data: TodayResponse; cachedAt: number } | null {
  const entry = read<CachedPlan>(PLAN_KEY);
  if (!entry?.data) return null;
  if (now < entry.data.dayStart || now >= entry.data.dayEnd) return null;
  return entry;
}

/** Sign-in and sign-out both change who "today" belongs to. */
export function clearCachedPlan(): void {
  try {
    store()?.removeItem(PLAN_KEY); // Discard pre-account-scoping cache data too.
    store()?.removeItem(accountStorageKey(PLAN_KEY));
  } catch {
    /* Unavailable storage must not prevent local sign-out. */
  }
}

export function clearOfflineState(): void {
  clearCachedPlan();
  store()?.removeItem(accountStorageKey(QUEUE_KEY));
}

/* ── The queue ───────────────────────────────────────────────────────────── */

export function pending(): PendingAction[] {
  return read<PendingAction[]>(QUEUE_KEY) ?? [];
}

export function enqueue(
  action: Omit<PendingAction, "id"> & { id?: string },
): PendingAction {
  const entry: PendingAction = {
    ...action,
    id: action.id ?? crypto.randomUUID(),
  };
  if (!write(QUEUE_KEY, [...pending(), entry])) {
    throw new Error(
      "Couldn't save this action: device storage is unavailable or full.",
    );
  }
  return entry;
}

export function forget(ids: readonly string[]): void {
  const drop = new Set(ids);
  write(
    QUEUE_KEY,
    pending().filter((action) => !drop.has(action.id)),
  );
}

/**
 * Show the day as the user has left it, not as the server last saw it.
 *
 * Without this a slot ticked off offline springs back to "planned" on the next
 * render, which reads as the app having lost the action. Applied over the
 * cached plan rather than written into it, so a successful refresh from the
 * server simply wins.
 */
export function withPending(
  data: TodayResponse,
  actions: readonly PendingAction[],
): TodayResponse {
  if (actions.length === 0) return data;

  const slots = new Map(data.slots.map((slot) => [slot.id, slot]));
  // Replay in order, including actual Start times. Repeated Start delivery
  // must not renew a running slot's stop window; a real resume gets a new one.
  for (const action of actions) {
    const slot = slots.get(action.slotId);
    if (!slot || (action.kind === "start" && slot.status === "started"))
      continue;
    slots.set(slot.id, {
      ...slot,
      status:
        action.kind === "start"
          ? "started"
          : action.kind === "complete"
            ? "completed"
            : "skipped",
      startedAt: action.kind === "start" ? action.at : null,
    });
  }
  return { ...data, slots: [...slots.values()] };
}
