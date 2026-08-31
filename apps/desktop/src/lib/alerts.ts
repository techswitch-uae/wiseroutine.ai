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
 * What is left here is the asking and the pushing. The *deciding* - which slot
 * is up next, and when to announce a start - moved into `src-tauri/tray.rs`,
 * because both used to run on timers in this webview and closing the window
 * hides it rather than quitting: a hidden WKWebView is throttled and then
 * suspended, so the menu bar froze mid-day and start notifications never
 * arrived - which is that first paragraph coming true by accident.
 *
 * `upNextOf` stayed, and is now the rail's - and the one thing the tray menu
 * still asks the webview, which is what "Start now" starts.
 */

import type { TodaySlot } from "./api";

const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

/** Statuses that still have a start ahead of them. Anything else has been
 *  dealt with, and an alert for it would be an apology for arriving late. */
const PENDING = new Set(["planned", "live"]);

/**
 * What is next, in the words a screen would use.
 *
 * The rail's own reading of the day - see `modules/dashboard`. The menu bar
 * had the same shape pushed to it until it grew its own clock; it now takes
 * the schedule and works this out for itself in `tray.rs`, and `upNextOf`
 * stays here because "Start now" on the tray menu still has to decide what
 * "next" meant at the moment it was pressed.
 */
export interface UpNext {
  /** What it is, on its own. The menu bar and the rail both name it. */
  title?: string;
  /** How long it runs, written out. */
  label?: string;
  /** "18m", or "now" once it can be started. */
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
  // Both units named. Without the second one this read "9h 10", which is not
  // a duration - it is two numbers, and the eye has to guess which.
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** What the menu bar should say. Undefined fields leave the icon bare, which
 *  is the right look for a day with nothing left in it. */
const minutesOf = (slot: TodaySlot): number =>
  Math.round((slot.endsAt - slot.startsAt) / 60_000);

export function upNextOf(slots: readonly TodaySlot[], now: number): UpNext {
  const next = slots
    .filter((slot) => PENDING.has(slot.status) && slot.endsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)[0];

  if (!next) return {};

  const live = next.startsAt <= now;
  return {
    title: next.title,
    label: `${minutesOf(next)} min`,
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

/**
 * Hand the app the day, and let it keep its own time.
 *
 * It used to be handed the finished sentence - "Breathing · now" - worked out
 * here and re-pushed every thirty seconds. Closing the window hides it rather
 * than quitting, and a hidden WKWebView's timers are throttled and eventually
 * suspended, so the re-pushes stopped and the menu bar sat there naming an
 * activity that had already finished. The clock that has to keep running now
 * runs in `tray.rs`, which is not something macOS puts to sleep.
 *
 * Only what is left: a slot that has been dealt with has nothing to announce
 * and nothing to count down to.
 */
async function pushSchedule(slots: readonly TodaySlot[]): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_schedule", {
      entries: slots
        .filter((slot) => PENDING.has(slot.status))
        .map(({ id, title, startsAt, endsAt }) => ({
          id,
          title,
          startsAt,
          endsAt,
        })),
    });
  } catch (error) {
    console.error("schedule refused", error);
  }
}

/**
 * Say what the day holds, and let the app take it from there.
 *
 * Called on every reload of the plan and on nothing else. There is no timer
 * behind this any more and no disposer to hand back: `tray.rs` re-reads what
 * it was given every fifteen seconds, on a clock macOS does not suspend.
 */
export function armAlerts(slots: readonly TodaySlot[]): void {
  if (!inTauri()) return;
  void pushSchedule(slots);
}
