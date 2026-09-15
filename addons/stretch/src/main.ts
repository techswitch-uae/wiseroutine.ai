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
 *
 * The line those two draw is why there is no button on the last step. This
 * addon's button means "move the routine on", and on the last step there is
 * nothing to move on to - what is left is ending the *slot*, which is the
 * host's "Done early" sitting right underneath. A second button there would
 * be two controls for one action, one of which cannot actually do it: the
 * addon holds `ui:session` and nothing else, so it could not complete the
 * slot however the button was labelled.
 */

import { connect } from "@wiseroutine/addon-sdk";
import {
  advance,
  clock,
  leftOn,
  markup,
  onLastStep,
  type Progress,
  startAt,
  stepsFor,
} from "./routine";

async function main(): Promise<void> {
  const wr = await connect();
  const { config } = await wr.session<{ routine?: string }>();
  const theme = wr.theme;

  const steps = stepsFor(config?.routine);
  document.body.innerHTML = markup(steps, theme);

  const left = document.querySelector<HTMLElement>(".left");
  const until = document.querySelector<HTMLElement>(".until");
  const say = document.querySelector<HTMLElement>(".say");
  const next = document.querySelector<HTMLButtonElement>(".next");
  const pips = [...document.querySelectorAll<HTMLElement>(".pip")];

  let at: Progress = startAt(steps, Date.now());

  const show = () => {
    const step = steps[at.index];
    if (say) {
      say.textContent = at.finished
        ? "That is the routine. Press Done early to finish."
        : (step?.text ?? "");
    }
    if (until) {
      until.textContent = at.finished
        ? ""
        : onLastStep(steps, at)
          ? "until this finishes"
          : "until the next step";
    }
    // Taken off the last step rather than relabelled - see the note above.
    if (next) next.hidden = at.finished || onLastStep(steps, at);
    for (const [i, pip] of pips.entries()) {
      pip.classList.toggle("on", at.finished || i <= at.index);
    }
    if (at.finished && left) left.textContent = "";
  };

  const step = () => {
    at = advance(steps, at, Date.now());
    show();
  };

  const draw = () => {
    if (at.finished) return;
    const remaining = leftOn(at, Date.now());
    if (left) left.textContent = clock(remaining);
    if (remaining === 0) step();
  };

  next?.addEventListener("click", step);
  show();
  draw();
  const timer = setInterval(draw, 250);
  globalThis.addEventListener("pagehide", () => clearInterval(timer));
}

void main().catch((error: unknown) => {
  document.body.textContent =
    error instanceof Error ? error.message : "The stretch could not start.";
});
