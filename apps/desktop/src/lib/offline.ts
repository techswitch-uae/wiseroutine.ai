import type { TodayResponse } from "./api";

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

const store = (): Storage | undefined => globalThis.localStorage;

function read<T>(key: string): T | null {
  const raw = store()?.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A half-written or older-format entry is not worth recovering; the next
    // successful request replaces it.
    store()?.removeItem(key);
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // A full quota must never break the request that triggered the save.
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
export function clearOfflineState(): void {
  store()?.removeItem(PLAN_KEY);
  store()?.removeItem(QUEUE_KEY);
}

/* ── The queue ───────────────────────────────────────────────────────────── */

export function pending(): PendingAction[] {
  return read<PendingAction[]>(QUEUE_KEY) ?? [];
}

export function enqueue(action: Omit<PendingAction, "id">): PendingAction {
  const entry: PendingAction = { id: crypto.randomUUID(), ...action };
  write(QUEUE_KEY, [...pending(), entry]);
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

  const latest = new Map<string, PendingKind>();
  // Later actions win: start then complete on the same slot is completed.
  for (const action of actions) latest.set(action.slotId, action.kind);

  return {
    ...data,
    slots: data.slots.map((slot) => {
      const kind = latest.get(slot.id);
      if (!kind) return slot;
      return {
        ...slot,
        status:
          kind === "start"
            ? ("started" as const)
            : kind === "complete"
              ? ("completed" as const)
              : ("skipped" as const),
      };
    }),
  };
}
