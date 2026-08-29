/**
 * The clock every timed session runs on.
 *
 * Beside `session-chrome` rather than inside it because a hook and a formatter
 * are not components, and a file that exports both loses fast refresh for the
 * components in it.
 */

import { useEffect, useRef, useState } from "react";

/** Seconds remaining, ticking. Returns 0 once the slot's time is up. */
export function useCountdown(endsAt: number): number {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.round((endsAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    // Every second, and re-read from the clock each time rather than
    // decremented: a decremented counter drifts, and a laptop that slept for
    // ten minutes wakes up ten minutes behind.
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [endsAt]);

  return left;
}

export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Count down to a slot's end, and say so exactly once.
 *
 * The "once" is the whole reason this exists. Every timed session wants to
 * finish itself when its time is up, and the obvious `useEffect(() => { if
 * (left === 0) onDone() }, [left, onDone])` fires again on every render for as
 * long as the component is still mounted - which, between the API call and the
 * reload that unmounts it, is several. Three sessions each recording
 * themselves complete two or three times is a progress number quietly going
 * wrong, and nobody would ever see it happen.
 */
export function useEndsAt(endsAt: number, onEnd: () => void): number {
  const left = useCountdown(endsAt);
  const fired = useRef(false);

  // A ref rather than state: whether we have already said so is bookkeeping,
  // not something the screen renders, and making it state would re-render
  // every session one extra time to no effect.
  const latest = useRef(onEnd);
  latest.current = onEnd;

  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    latest.current();
  }, [left]);

  return left;
}
