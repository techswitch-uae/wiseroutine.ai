/**
 * The entry point.
 *
 * Connects, draws the block, ticks the clock, and hands the Spotify link to
 * the machine if the user presses for it.
 */

import { connect } from "@wiseroutine/addon-sdk";
import { clock, markup, secondsLeft, spotify } from "./focus";

async function main(): Promise<void> {
  const wr = await connect();
  const { slot, config } = await wr.session<{ musicUrl?: string }>();
  const theme = wr.theme;

  const music = spotify(config?.musicUrl);
  document.body.innerHTML = markup(music, theme);

  const what = document.querySelector<HTMLElement>(".what");
  const left = document.querySelector<HTMLElement>(".left");
  // `textContent`, not `innerHTML`. The title is the user's own activity name
  // and comes from the host, but a value that reaches a document as markup is
  // a value somebody eventually gets to choose.
  if (what) what.textContent = slot.title;

  const draw = () => {
    if (left) left.textContent = clock(secondsLeft(slot.endsAt, Date.now()));
  };
  draw();
  const timer = setInterval(draw, 1_000);
  globalThis.addEventListener("pagehide", () => clearInterval(timer));

  const out = document.querySelector<HTMLButtonElement>(".out");
  if (out && music) {
    out.addEventListener("click", () => {
      /**
       * Said out loud when the machine will not take it.
       *
       * `openExternal` resolves false when the OS refuses the link, and
       * rejects when the host does - a capability this addon was not granted,
       * or an origin outside the one its manifest declared. Both end up as a
       * sentence on the button rather than as silence: a link that does
       * nothing reads as a broken addon, and the user cannot see the console.
       */
      void wr
        .openExternal(music.open)
        .then((opened) => {
          if (opened) return;
          out.textContent = "Couldn't open Spotify from here.";
          out.disabled = true;
        })
        .catch(() => {
          out.textContent = "Not allowed to open that link.";
          out.disabled = true;
        });
    });
  }
}

void main().catch((error: unknown) => {
  document.body.textContent =
    error instanceof Error ? error.message : "The block could not start.";
});
