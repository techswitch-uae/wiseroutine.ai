import type { AddonTheme } from "@wiseroutine/addon-sdk";
import { type DayTally, footnoteOf, headlineOf, spanOf, totalOf } from "./day";

/**
 * What the card draws, as one string.
 *
 * The same markup-as-a-function shape every addon in this repo uses: a pure
 * function tested by reading its output, rather than a DOM built across a
 * dozen statements that only a browser can run.
 *
 * ## Why it restates the app's own type scale
 *
 * The frame is a separate document with an opaque origin, so it inherits no
 * stylesheet - `.wr-widget-title` means nothing inside it. The sizes and
 * weights here are copied from `app.css` on purpose, and the *colours* are
 * not: those come from the theme the host resolved and sent, so the card
 * follows the user's light or dark choice rather than guessing.
 *
 * That is the honest cost of the boundary, and it is the right trade. An addon
 * that could reach the host's stylesheet could also read the host's DOM.
 */

/**
 * How tall the card needs to be.
 *
 * Measured, not calculated. The first version added up a base and a line
 * height per optional element, which is a formula that is wrong the moment
 * anything about the type changes - and it was already wrong: it left a
 * finger's width of empty card under the footnote.
 *
 * Measured *here* rather than by the host, because the host cannot see inside
 * the frame. Clamped *there* rather than here, because a number an addon
 * computes is a number an addon can get wrong - see `cardHeightFor`.
 *
 * The body box, not `documentElement.scrollHeight`. The root element's scroll
 * height is floored at the viewport, so it answers "how tall is the frame"
 * rather than "how tall is the content" - which is how the first attempt at
 * this asked for the maximum every time, and got it.
 */
export const heightOf = (root: Document): number =>
  Math.ceil(root.body.getBoundingClientRect().height);

export function markup(
  t: DayTally,
  timeZone: string,
  theme: AddonTheme,
): string {
  const total = totalOf(t);
  const footnote = footnoteOf(t, timeZone);
  const ratio = total > 0 ? t.done / total : 0;

  return `<style>
  html, body { margin: 0; background: transparent; }
  body {
    font-family: ${theme.fontBody};
    color: ${theme.text};
    -webkit-font-smoothing: antialiased;
    /* So the body box is the height of what is in it. Without a block
       formatting context the first and last child's margins collapse straight
       through the body, and the card measures shorter than it draws. */
    display: flow-root;
  }
  .title {
    margin: 0 0 2px; font: 600 15px/1.25 ${theme.fontHeading};
    overflow-wrap: anywhere;
  }
  .time {
    font: 600 12.5px ${theme.fontBody}; color: ${theme.accent};
    font-variant-numeric: tabular-nums;
  }
  .soft { font-weight: 400; color: ${theme.muted}; }
  .metric { margin-top: 12px; }
  .head {
    display: flex; justify-content: space-between;
    font: 600 12px ${theme.fontBody}; margin-bottom: 5px;
  }
  .head span:last-child { color: ${theme.muted}; }
  .bar {
    height: 6px; border-radius: 999px; background: ${theme.track};
    overflow: hidden;
  }
  .fill {
    height: 100%; border-radius: 999px; background: ${theme.accent};
    /* Animated, because this bar moves in answer to a press the user just
       made. Jumping is the one thing that reads as a redraw rather than as
       progress. */
    transition: width 240ms ease;
  }
  .note {
    margin: 10px 0 0; font: 400 12.5px/1.45 ${theme.fontBody};
    color: ${theme.muted};
  }
</style>
<h3 class="title"></h3>
<div class="time">
  <span class="done"></span>
  <span class="soft ahead"></span>
</div>
<div class="metric">
  <div class="head"><span>Done</span><span class="count"></span></div>
  <div class="bar"><div class="fill" style="width: ${ratio * 100}%"></div></div>
</div>
<p class="note"${footnote ? "" : " hidden"}></p>`;
}

/**
 * Put today's reading into the markup above.
 *
 * Separate from `markup` because the card is redrawn every time the day
 * changes, and rewriting `innerHTML` on each one would restart the bar's
 * transition from zero and lose the very animation it exists for. Text nodes
 * and one width, nothing else.
 *
 * `textContent` throughout, never `innerHTML`: the strings are this addon's
 * own, but a slot's *title* is typed by the user and one of them will
 * eventually contain a `<`.
 */
export function fill(root: ParentNode, t: DayTally, timeZone: string): void {
  const total = totalOf(t);
  const footnote = footnoteOf(t, timeZone);

  const set = (selector: string, text: string) => {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) el.textContent = text;
  };

  set(".title", headlineOf(t));
  set(".done", `${spanOf(t.doneMinutes)} done`);
  set(".ahead", t.aheadMinutes > 0 ? ` · ${spanOf(t.aheadMinutes)} to go` : "");
  set(".count", `${t.done} / ${total}`);
  set(".note", footnote);

  const note = root.querySelector<HTMLElement>(".note");
  if (note) note.hidden = footnote === "";

  const fillBar = root.querySelector<HTMLElement>(".fill");
  if (fillBar) {
    fillBar.style.width = `${(total > 0 ? t.done / total : 0) * 100}%`;
  }
}
