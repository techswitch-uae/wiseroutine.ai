/**
 * The entry point.
 *
 * Connects, reads the routine, and walks the steps.
 *
 * ## The button is the addon's, the way out is the host's
 *
 * "Next step" is drawn here, inside the frame, because it is about the
 * routine. Done and Stop are drawn by the host outside it, because they are
 * about the *slot* - and a session whose exit button belonged to the addon
 * would be an exit button the addon could refuse to honour.
 *
 * The built-in version this replaces overloaded the host's Done button as
 * "Next step", which meant the only way to leave a stretch early was Stop,
 * and Stop records a skip. Somebody who finished three of four steps was
 * telling their week they had done none.
 */

import { connect } from "@wiseroutine/addon-sdk";
import { clock, markup, type Step, stepsFor } from "./routine";

async function main(): Promise<void> {
  const wr = await connect();
  const { config, theme } = await wr.session<{ routine?: string }>();

  const steps = stepsFor(config?.routine);
  document.body.innerHTML = markup(steps, theme);

  const left = document.querySelector<HTMLElement>(".left");
  const until = document.querySelector<HTMLElement>(".until");
  const say = document.querySelector<HTMLElement>(".say");
  const next = document.querySelector<HTMLButtonElement>(".next");
  const pips = [...document.querySelectorAll<HTMLElement>(".pip")];

  let index = 0;
  // A deadline, not a number of ticks: a counter decremented once a second
  // drifts, and a laptop that slept through a step wakes up still counting it.
  let endsAt = Date.now() + (steps[0] as Step).seconds * 1_000;
  let done = false;

  const show = () => {
    const step = steps[index] as Step;
    const last = index + 1 >= steps.length;
    if (say) say.textContent = step.text;
    if (until) {
      until.textContent = last ? "until this finishes" : "until the next step";
    }
    if (next) next.textContent = last ? "Finish the routine" : "Next step";
    for (const [i, pip] of pips.entries()) {
      pip.classList.toggle("on", i <= index);
    }
  };

  /**
   * The end of the routine, which is not the end of the slot.
   *
   * The addon cannot complete a slot - that is `write:own`, and this addon
   * holds only `ui:session`. So it says so and stops, and the host's clock
   * completes the slot when its time is up, or the user presses Done. Saying
   * "that is the routine" beats a frozen last step with no explanation.
   */
  const finish = () => {
    done = true;
    if (say) say.textContent = "That is the routine. Well done.";
    if (left) left.textContent = "";
    if (until) until.textContent = "";
    next?.remove();
    for (const pip of pips) pip.classList.add("on");
  };

  const advance = () => {
    if (done) return;
    index += 1;
    if (index >= steps.length) return finish();
    endsAt = Date.now() + (steps[index] as Step).seconds * 1_000;
    show();
  };

  const draw = () => {
    if (done) return;
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1_000));
    if (left) left.textContent = clock(remaining);
    if (remaining === 0) advance();
  };

  next?.addEventListener("click", advance);
  show();
  draw();
  const timer = setInterval(draw, 250);
  globalThis.addEventListener("pagehide", () => clearInterval(timer));
}

void main().catch((error: unknown) => {
  document.body.textContent =
    error instanceof Error ? error.message : "The stretch could not start.";
});
