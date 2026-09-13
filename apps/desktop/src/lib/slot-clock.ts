import { type StartedSlot, slotStopDeadline } from "@wiseroutine/scheduler";
import { useEffect, useReducer } from "react";

/** Refresh at the stop cutoff itself, as well as on wake/focus and at the end. */
export function useSlotClock(slot?: StartedSlot): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const deadline = slot ? slotStopDeadline(slot) : null;
  const end = slot?.endsAt;
  useEffect(() => {
    const interval = setInterval(tick, 30_000);
    const timers = [deadline, end]
      .filter((at): at is number => at != null && at > Date.now())
      .map((at) => setTimeout(tick, Math.min(at - Date.now(), 2_147_483_647)));
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      for (const timer of timers) clearTimeout(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline, end]);
  return Date.now();
}
