/**
 * Telling the user about a slot when the app is *not* in front of them.
 *
 * The counterpart to `lib/notify`, and the reason that file draws the line
 * where it does: an in-app toast reaches someone already looking at the
 * window, which during a deep work block is nobody. A routine that only speaks
 * when you are watching it is a list, not a routine.
 *
 * Everything here is a no-op in a browser, the same way `lib/updates` is. The
 * same frontend ships as the web app, where there is no menu bar to put a
 * countdown in and importing the plugin at all would drag Tauri's IPC into a
 * bundle with no host to talk to. So the host is feature-detected and the
 * plugins are imported dynamically behind that check.
 *
 * The two exported decisions - `dueAlerts` and `upNextOf` - are pure and take
 * `now`, because that is the only way to test "fires once, at the right time,
 * and not again on the next reload" without waiting for a clock.
 */

import type { TodaySlot } from "./api";

const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

/** Statuses that still have a start ahead of them. Anything else has been
 *  dealt with, and an alert for it would be an apology for arriving late. */
const PENDING = new Set(["planned", "live"]);

/**
 * How late an alert may still fire.
 *
 * A slot whose start was missed while the machine was asleep should not
 * announce itself an hour afterwards - by then the day has been replanned
 * around it and the notification is a lie. But firing only on the exact
 * millisecond loses every alert to a timer that ran a beat late, so there is a
 * window rather than an instant.
 */
const LATE_MS = 90_000;

/** A slot whose start we have already announced. Keyed by time as well as id,
 *  so a slot that moves is announced again at its new time - which is the
 *  whole point of a plan that rebuilds itself. */
const announced = new Set<string>();

const keyOf = (slot: TodaySlot): string => `${slot.id}@${slot.startsAt}`;

/**
 * Quiet until this instant.
 *
 * Only the speaking is paused, not the plan: slots still run, still go live
 * and still count. Someone in a meeting wants the day to carry on without
 * being told about it, and a pause that also stopped planning would hand them
 * back an empty afternoon.
 *
 * ponytail: in memory, so it is forgotten on restart. That is the right
 * default for an hour-long pause - a machine that has been restarted has
 * almost certainly outlived the meeting.
 */
let pausedUntil = 0;

export const PAUSE_MS = 60 * 60_000;

export function pauseAlerts(now: number, ms: number = PAUSE_MS): void {
  pausedUntil = now + ms;
}

export const pausedThrough = (): number => pausedUntil;

export interface Alert {
  slotId: string;
  title: string;
  body: string;
  /** When it should fire. In the past by up to `LATE_MS` means "now". */
  at: number;
}

const minutesOf = (slot: TodaySlot): number =>
  Math.round((slot.endsAt - slot.startsAt) / 60_000);

/**
 * The alerts a plan still owes, in the order they come due.
 *
 * Pure, and deliberately not filtered by what has already fired: that is
 * `armAlerts`'s job, and keeping it out of here is what makes this testable by
 * calling it twice with two different clocks. The pause *is* in here, because
 * it is a property of the plan rather than of this session's bookkeeping.
 */
export function dueAlerts(
  slots: readonly TodaySlot[],
  now: number,
): readonly Alert[] {
  return slots
    .filter(
      (slot) =>
        PENDING.has(slot.status) &&
        slot.startsAt > now - LATE_MS &&
        slot.startsAt >= pausedUntil,
    )
    .map((slot) => ({
      slotId: slot.id,
      title: slot.title,
      body: `${minutesOf(slot)} min. Starting now.`,
      at: slot.startsAt,
    }))
    .sort((a, b) => a.at - b.at);
}

export interface UpNext {
  label?: string;
  badge?: string;
  slotId?: string;
}

/**
 * How long until something, in as few characters as the menu bar deserves.
 *
 * Rounded up, because a slot 90 seconds away reading "1m" and then sitting
 * there for the next 89 of them looks stuck.
 */
export function countdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
}

/** What the menu bar should say. Undefined fields leave the icon bare, which
 *  is the right look for a day with nothing left in it. */
export function upNextOf(slots: readonly TodaySlot[], now: number): UpNext {
  const next = slots
    .filter((slot) => PENDING.has(slot.status) && slot.endsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)[0];

  if (!next) return {};

  const live = next.startsAt <= now;
  return {
    label: `${next.title} · ${minutesOf(next)} min`,
    badge: live ? "now" : countdown(next.startsAt - now),
    // Only offered while it is actually startable. Starting something an hour
    // early is not a shortcut, it is a different plan.
    ...(live ? { slotId: next.id } : {}),
  };
}

/** Whether we may already speak, without asking. Separate from
 *  `ensureAlertPermission` so a checklist can show the state of the step
 *  without the act of rendering it throwing a system prompt at someone. */
export async function alertPermissionGranted(): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    const { isPermissionGranted } = await import(
      "@tauri-apps/plugin-notification"
    );
    return await isPermissionGranted();
  } catch {
    return false;
  }
}

/** Whether this host has notifications to grant at all. The web build has a
 *  menu bar nowhere and a permission for nothing. */
export const alertsAvailable = (): boolean => inTauri();

/** Ask once, and say whether we may speak. Safe to call repeatedly - the
 *  plugin answers from cache after the first grant. */
export async function ensureAlertPermission(): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch (error) {
    console.error("notification permission", error);
    return false;
  }
}

async function send(alert: Alert): Promise<void> {
  try {
    const { sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    sendNotification({ title: alert.title, body: alert.body });
  } catch (error) {
    console.error("notification refused", error);
  }
}

async function pushUpNext(next: UpNext): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_up_next", { next });
  } catch (error) {
    console.error("menu bar refused", error);
  }
}

/**
 * Arm the day: one timer per slot start, plus the menu bar.
 *
 * Called again on every reload of the plan, so it returns a disposer and the
 * caller is expected to use it. Re-arming is how a replanned day keeps its
 * alerts honest; `announced` is what stops the re-arm from announcing the same
 * start twice.
 */
export function armAlerts(
  slots: readonly TodaySlot[],
  now: number,
): () => void {
  if (!inTauri()) return () => undefined;

  // The menu bar keeps saying what is next while paused. Pausing silences the
  // interruptions, not the information - going quiet as well would leave
  // someone with no way to see what they are missing.
  void pushUpNext(upNextOf(slots, now));

  const timers = dueAlerts(slots, now).map((alert) => {
    const slot = slots.find((s) => s.id === alert.slotId);
    const key = slot ? keyOf(slot) : alert.slotId;
    if (announced.has(key)) return undefined;

    return setTimeout(
      () => {
        announced.add(key);
        void send(alert);
      },
      Math.max(0, alert.at - now),
    );
  });

  return () => {
    for (const timer of timers) if (timer !== undefined) clearTimeout(timer);
  };
}

/** Test seam. The announced set is module state on purpose - it has to outlive
 *  every re-arm - which means a test needs a way to start from nothing. */
export function resetAnnounced(): void {
  announced.clear();
  pausedUntil = 0;
}
