/**
 * The entry point.
 *
 * Connects to the host, asks what session it was loaded for, and drives the
 * pacer in `pacer.ts`. Everything an addon may do is imported from
 * `@wiseroutine/addon-sdk` on the next line, and there is no second import
 * that reaches the app.
 */

import { connect } from "@wiseroutine/addon-sdk";
import { markup, patternFor, phaseAt } from "./pacer";

/** Four ticks a second, so the word turns at the phase boundary rather than
 *  up to a second after it. */
const TICK_MS = 250;

async function main(): Promise<void> {
  const wr = await connect();
  const { slot, config } = await wr.session();

  const pattern = patternFor(config);
  document.body.innerHTML = markup(pattern);

  const phase = document.querySelector<HTMLElement>(".phase");
  const left = document.querySelector<HTMLElement>(".left");

  /**
   * Elapsed is read from the clock, not counted up.
   *
   * The word and the circle are two clocks describing one breath. A counter
   * that added one per interval kept every late tick, fell behind the CSS
   * animation, and ended up saying "Breathe out" over a circle already
   * filling.
   */
  const startedAt = Date.now();

  const draw = () => {
    const now = Date.now();
    if (phase) phase.textContent = phaseAt(pattern, (now - startedAt) / 1_000);
    if (left) {
      const minutes = Math.max(0, Math.ceil((slot.endsAt - now) / 60_000));
      left.textContent = `${minutes} min left`;
    }
  };

  draw();
  const timer = setInterval(draw, TICK_MS);

  // The host tears the frame down when the session ends, which takes the
  // interval with it. Cleared anyway: an addon that leaks a timer on a page
  // it does not own is an addon nobody can see misbehaving.
  globalThis.addEventListener("pagehide", () => clearInterval(timer));
}

// The host is the only thing that loads this file, and a rejection here means
// a blank session. Say so where a user can be shown it rather than failing
// silently into an empty frame.
void main().catch((error: unknown) => {
  document.body.textContent =
    error instanceof Error ? error.message : "Breathing could not start.";
});
