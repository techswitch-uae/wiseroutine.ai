/**
 * Look away from the screen.
 *
 * The one session where the *screen* is the problem, so it is mostly an
 * absence: a dark ground, a distance to focus on, and a number big enough to
 * read from across the room. There is nothing to watch here on purpose.
 *
 * Written as an addon rather than compiled into the app, like every other
 * guided session Wise Routine ships. See `addons/breathing` for the reference
 * on how one is put together; this half is pure, and `main.ts` is the entry.
 *
 * ## Why it does not use the theme
 *
 * The activity type declares `ground: "dim"`, so the host paints a near-black
 * canvas behind this frame whatever the user's theme is. Light text on it is
 * correct in both themes, and reading `theme.text` here would produce near-
 * black text on a near-black ground in the light theme - which is the exact
 * bug the theme exists to prevent, arrived at by using it.
 */

/** The light the dim ground is drawn for. Same value the host uses. */
export const ON_DIM = "#f6f1e8";

export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Seconds left, never negative and never a fraction.
 *
 * Rounded rather than floored so the first second on screen is the whole
 * duration: a five-minute rest that opens saying 4:59 reads as one that
 * started before you were looking at it.
 */
export const secondsLeft = (endsAt: number, now: number): number =>
  Math.max(0, Math.round((endsAt - now) / 1000));

/**
 * How far to look, as a sentence.
 *
 * The metres are the user's setting and go into text rather than into a
 * layout, so there is nothing to escape - but it is still clamped, because a
 * config written by hand could carry anything and "look at something about
 * NaN metres away" is a session that looks broken.
 */
export function sentence(metres: unknown): string {
  const value =
    typeof metres === "number" && Number.isFinite(metres) ? metres : 6;
  const rounded = Math.min(50, Math.max(1, Math.round(value)));
  return `Look at something about ${rounded} metres away. A window is ideal.`;
}

/**
 * The whole document body.
 *
 * A template string rather than a DOM tree, for the reason `addons/breathing`
 * gives at length: an addon draws one thing and then updates two numbers in
 * it, and a builder for that is more code than the thing it builds.
 *
 * Note the absence of backticks in the CSS below. This is a template literal,
 * and a backtick inside a comment in it ends the string - which has cost this
 * repository an afternoon before.
 */
export function markup(text: string): string {
  return `<style>
  html, body { background: transparent; margin: 0; height: 100%; }
  .wrap {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px;
    color: ${ON_DIM};
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    text-align: center;
  }
  .left {
    font: 400 64px/1 ui-serif, Georgia, serif;
    font-variant-numeric: tabular-nums;
  }
  .say { font-size: 17px; line-height: 1.5; max-width: 380px; opacity: .8; margin: 0; }
</style>
<div class="wrap">
  <div class="left" aria-live="off">--:--</div>
  <p class="say">${text}</p>
</div>`;
}
