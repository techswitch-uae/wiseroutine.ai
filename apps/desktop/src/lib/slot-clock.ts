import {
  type StartedSlot,
  slotActionDeadline,
  slotStopDeadline,
} from "@wiseroutine/scheduler";
import { useEffect, useReducer } from "react";

/** Refresh at action cutoffs themselves, as well as on wake/focus and at the end. */
export function useSlotClock(slot?: StartedSlot): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const deadline = slot ? slotStopDeadline(slot) : null;
  const actionDeadline = slot ? slotActionDeadline(slot) : null;
  const end = slot?.endsAt;
  useEffect(() => {
    const interval = setInterval(tick, 30_000);
    const timers = [deadline, actionDeadline, end]
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
  }, [deadline, actionDeadline, end]);
  return Date.now();
}
