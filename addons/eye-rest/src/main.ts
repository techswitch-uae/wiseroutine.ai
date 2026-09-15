/**
 * The entry point.
 *
 * Connects, asks what session it was loaded for, and ticks a countdown.
 * Nothing else: the host completes the slot when the time is up, so this does
 * not have to notice - and an eye rest that asked you to come back and press
 * a button would defeat the exercise.
 */

import { connect } from "@wiseroutine/addon-sdk";
import { clock, markup, secondsLeft, sentence } from "./rest";

async function main(): Promise<void> {
  const wr = await connect();
  const { slot, config } = await wr.session<{ metres?: number }>();

  document.body.innerHTML = markup(sentence(config?.metres));
  const left = document.querySelector<HTMLElement>(".left");

  // Read from the clock every tick rather than decremented. A counter drifts,
  // and a laptop that slept through half the rest wakes up still counting it.
  const draw = () => {
    if (left) left.textContent = clock(secondsLeft(slot.endsAt, Date.now()));
  };

  draw();
  const timer = setInterval(draw, 1_000);
  globalThis.addEventListener("pagehide", () => clearInterval(timer));
}

void main().catch((error: unknown) => {
  document.body.textContent =
    error instanceof Error ? error.message : "Eye rest could not start.";
});
