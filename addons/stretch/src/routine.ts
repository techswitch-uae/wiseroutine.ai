/**
 * A stretch, one step at a time.
 *
 * Numbered steps with a countdown to the next one, because a ten-minute block
 * labelled "stretch" is a block people spend looking at their phone, and four
 * things to do in order is an activity.
 *
 * Steps advance on their own when their time is up. Someone with their arm in
 * a doorway cannot reach the keyboard, which is the entire reason a guided
 * stretch is guided - the button is for going early, not for getting through.
 *
 * An addon, like every guided session Wise Routine ships. `main.ts` is the
 * entry; this half is pure. See `addons/breathing` for the reference.
 *
 * ## What changed in the move
 *
 * The built-in version stored its four steps in the activity's config, where
 * nothing could edit them - a config field with no form is a field that is
 * only ever its default. An addon's settings are declared as a schema the host
 * renders, and a schema has no way to say "a list of steps with durations", so
 * the steps moved into the bundle and the *choice between routines* became the
 * setting. That is the better shape anyway: three routines somebody thought
 * about beat one nobody could change.
 */

export interface Step {
  text: string;
  seconds: number;
}

/**
 * The routines, and the reason there are three.
 *
 * A desk does the same three things to a body - closes the chest, shortens the
 * hip flexors, and holds the wrists in one position - so these are one routine
 * each rather than a catalogue. Each runs about three minutes, which fits
 * inside the ten-minute default with room to be slow about it.
 */
export const ROUTINES: Record<string, readonly Step[]> = {
  "Shoulders & neck": [
    { text: "Stand, roll the shoulders back and forth", seconds: 40 },
    { text: "Doorway chest opener, 30s each side", seconds: 60 },
    { text: "Neck side bend, slow, both sides", seconds: 45 },
    { text: "Look out of the window, twenty seconds", seconds: 20 },
  ],
  "Back & hips": [
    { text: "Stand and reach up, then fold forward slowly", seconds: 40 },
    { text: "Half-kneeling hip flexor stretch, 30s each side", seconds: 60 },
    { text: "Seated spinal twist, both sides", seconds: 50 },
    { text: "Stand tall, breathe, roll the shoulders once", seconds: 20 },
  ],
  "Wrists & eyes": [
    { text: "Wrist circles, then palms together and press down", seconds: 40 },
    { text: "Extend one arm, pull the fingers back. Swap.", seconds: 50 },
    { text: "Shake the hands out loosely", seconds: 20 },
    { text: "Look at something far away, twenty seconds", seconds: 20 },
  ],
};

const DEFAULT_ROUTINE = "Shoulders & neck";

/**
 * The steps for a stored setting.
 *
 * Never empty and never throws. A config naming a routine this version does
 * not have - written by a newer one, or edited by hand - falls back rather
 * than opening an empty session, which is the same rule every part of this
 * boundary follows.
 */
export const stepsFor = (routine: unknown): readonly Step[] =>
  (typeof routine === "string" ? ROUTINES[routine] : undefined) ??
  (ROUTINES[DEFAULT_ROUTINE] as readonly Step[]);

export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export interface Theme {
  text: string;
  muted: string;
  hairline: string;
  fontBody: string;
  fontHeading: string;
}

/**
 * The document body: a step, a countdown, and one pip per step.
 *
 * Drawn against the host's resolved theme rather than a hard-coded colour.
 * This activity type declares no `ground`, so it sits on the app's own page
 * surface - which is cream in one theme and near-black in the other, and a
 * fixed colour is illegible in exactly one of them.
 *
 * No backticks in the CSS below: this is a template literal and one would end
 * the string.
 */
export function markup(steps: readonly Step[], theme: Theme): string {
  const pips = steps.map(() => `<span class="pip"></span>`).join("");

  return `<style>
  html, body { background: transparent; margin: 0; height: 100%; }
  .wrap {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px;
    color: ${theme.text};
    font-family: ${theme.fontBody};
    text-align: center;
  }
  .left { font: 400 44px/1 ${theme.fontHeading}; font-variant-numeric: tabular-nums; }
  .until { font-size: 13px; letter-spacing: .04em; opacity: .65; margin-top: -10px; }
  .say { font-size: 20px; line-height: 1.45; max-width: 420px; margin: 0; }
  .pips { display: flex; gap: 6px; }
  .pip { width: 22px; height: 3px; border-radius: 2px; background: ${theme.hairline}; }
  .pip.on { background: ${theme.text}; }
  .next {
    font: 600 13px ${theme.fontBody};
    border-radius: 999px; padding: 9px 18px; cursor: pointer;
    color: ${theme.text}; background: transparent;
    border: 1px solid ${theme.hairline};
  }
  .next:hover { border-color: ${theme.text}; }
</style>
<div class="wrap">
  <div class="left" aria-live="off">--:--</div>
  <div class="until"></div>
  <p class="say"></p>
  <div class="pips">${pips}</div>
  <button type="button" class="next">Next step</button>
</div>`;
}
