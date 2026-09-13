import { api, flushPending } from "./api";
import { notify } from "./notify";
import {
  isToday,
  manageToday,
  publishTodayPlan,
  reloadPlan,
  todaySnapshot,
} from "./plan-store";
import { markStarted } from "./running-slot";
import { onServerInvalidated, sessionGeneration } from "./session-lifecycle";

/** Operational today is independent of route and visible range. Kept alive by
 * the signed-in shell; foreground/online recovery and aligned minute ticks
 * cover a day change even when Settings or Week is open. Native events use the
 * same controller instead of a callback owned by the Day route. */
export function startTodayController(): () => void {
  const generation = sessionGeneration();
  const release = manageToday();
  let stopped = false;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout>;
  const current = () => !stopped && generation === sessionGeneration();
  const load = () => {
    const request = ++sequence;
    void api
      .today({ range: "full" })
      .then((plan) => {
        if (current() && request === sequence)
          publishTodayPlan(isToday(plan, Date.now()) ? plan : null);
      })
      .catch(() => {
        /* Keep the last known plan; never substitute another date. */
      });
  };
  const refresh = () => {
    if (current()) {
      load();
      reloadPlan();
    }
  };
  const catchUp = () => {
    if (!current()) return;
    const plan = todaySnapshot();
    if (plan && !isToday(plan, Date.now())) publishTodayPlan(null);
    const afterDrain = () => {
      if (current()) load();
    };
    void flushPending().then(afterDrain, afterDrain);
  };
  const tick = () => {
    timer = setTimeout(
      () => {
        catchUp();
        if (current()) tick();
      },
      60_000 - (Date.now() % 60_000),
    );
  };
  const unsubscribe = onServerInvalidated(refresh);
  globalThis.addEventListener?.("focus", catchUp);
  globalThis.addEventListener?.("online", catchUp);
  load();
  tick();
  return () => {
    stopped = true;
    sequence++;
    clearTimeout(timer);
    unsubscribe();
    release();
    globalThis.removeEventListener?.("focus", catchUp);
    globalThis.removeEventListener?.("online", catchUp);
  };
}

export async function startTodaySlot(slotId: string): Promise<void> {
  const generation = sessionGeneration();
  const plan = todaySnapshot();
  if (
    !plan ||
    !isToday(plan, Date.now()) ||
    !plan.slots.some((slot) => slot.id === slotId)
  )
    return;
  if (plan.slots.find((slot) => slot.id === slotId)?.status === "started")
    return;
  const startedAt = Date.now();
  markStarted(slotId, startedAt);
  publishTodayPlan({
    ...plan,
    slots: plan.slots.map((slot) =>
      slot.id === slotId ? { ...slot, status: "started", startedAt } : slot,
    ),
  });
  try {
    await api.startSlot(slotId);
  } catch {
    if (generation === sessionGeneration()) {
      publishTodayPlan(plan);
      notify("Couldn't start that just now.");
    }
  }
}
