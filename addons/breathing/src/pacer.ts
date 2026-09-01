/**
 * A pacer to breathe along with.
 *
 * This is the Wise Routine breathing session, and it is an addon like any
 * other: it runs in a sandboxed frame, it holds exactly one capability
 * (`ui:session`), and it has no access this file does not show. It used to be
 * compiled into the app. It is kept here, in the shape a stranger's submission
 * would arrive in, so that the path a community addon takes is the path the
 * app's own code takes - a path nobody maintains cannot be trusted.
 *
 * This half is pure: patterns, phase names, keyframes and markup, with no
 * DOM and no SDK. `main.ts` is the entry that connects to the host and
 * drives it. Split so the tests can import this without the entry running,
 * which is worth copying - an entry point that does work on import is one
 * that cannot be tested.
 *
 * ## No framework, on purpose
 *
 * Vanilla DOM, because an addon ships its own runtime: React here would be
 * forty kilobytes to draw a circle and a word. The SDK is framework-agnostic
 * and this is the demonstration of it - reach for a framework when the addon
 * has state worth managing, not by habit.
 *
 * ## What the host draws, and what this draws
 *
 * The frame around a session - its title, the Done and Stop buttons, the
 * chime, the `role="dialog"` - belongs to the host, and an addon cannot draw
 * or suppress any of it. That is deliberate. A full-window takeover whose exit
 * button was drawn by the addon would be an exit button the addon could fake
 * or refuse to honour. This file draws the inside; the way out is not its to
 * own.
 *
 * ## The animation
 *
 * One CSS keyframe set, computed from the pattern, rather than a
 * requestAnimationFrame loop. The browser interpolates on the compositor
 * already; driving it from JavaScript costs a frame budget to arrive at the
 * same circle, and stutters the moment anything else does work. The bar and
 * the circle are two animations on one clock, so they cannot drift apart.
 */

/** In, hold, out, hold - seconds. Every pattern worth having is four numbers. */
type Pattern = readonly [number, number, number, number];

const PATTERNS: Record<string, Pattern> = {
  /** Box breathing. The one most people have met. */
  "box 4-4-4-4": [4, 4, 4, 4],
  /** Longer out than in, which is the half that settles you. */
  "4-7-8": [4, 7, 8, 0],
  /** Coherent breathing - five and five, no holds. */
  "coherent 5-5": [5, 0, 5, 0],
};

const FALLBACK: Pattern = PATTERNS["box 4-4-4-4"] as Pattern;

/** The orb at its largest. It scales down to .55 on the out-breath. */
const ORB = 220;

/**
 * The phase bar: how long it is, and the room the stroke needs around it.
 *
 * Inset by a pixel at each end so the round cap - the same one the orb's
 * outline used to have - is not clipped by the viewBox. `BAR` is the length
 * the dash animates over, not the width of the element.
 */
const BAR = 98;
const BAR_BOX = { width: BAR + 2, height: 4 } as const;

const LABELS = ["Breathe in", "Hold", "Breathe out", "Hold"] as const;

/**
 * Which phase of the cycle a given second falls in.
 *
 * Exported for the tests, which are the addon's own - an addon is a package,
 * and a package with logic in it has tests.
 */
export function phaseAt(pattern: Pattern, elapsedSeconds: number): string {
  const total = pattern.reduce((a, b) => a + b, 0);
  if (total <= 0) return LABELS[0];

  let t = elapsedSeconds % total;
  for (const [index, seconds] of pattern.entries()) {
    // A zero-length phase is skipped rather than shown for an instant: "4-7-8"
    // has no closing hold, and flashing the word would be a lie about the
    // pattern.
    if (seconds > 0 && t < seconds) return LABELS[index] ?? LABELS[0];
    t -= seconds;
  }
  return LABELS[0];
}

/**
 * The bar under the phase, and how much of this phase is left in it.
 *
 * The ask was a countdown per phase that is not a number: watching digits is
 * not the same activity as breathing, and neither is counting dots. So the
 * bar is drawn full at the start of each phase and drains to nothing by the
 * end of it - four seconds of "in" and eight of "out" read as the same line
 * moving at two speeds, which is the thing being taught.
 *
 * It was a ring around the orb, and it competed with it: two concentric
 * things moving at different rates, both large, in a session whose whole
 * point is to be looked at loosely. A hundred pixels of hairline under the
 * word carries the same information and asks for none of the attention.
 */
export function barKeyframes(pattern: Pattern, cycle: number): string {
  const at = (seconds: number): string => ((seconds / cycle) * 100).toFixed(3);
  const keys = ["0% { stroke-dashoffset: 0 }"];
  let elapsed = 0;

  for (const seconds of pattern) {
    // A phase the pattern does not have - "4-7-8" has no closing hold - is not
    // an instant of empty bar.
    if (seconds <= 0) continue;
    elapsed += seconds;
    const pct = Number(at(elapsed));
    keys.push(`${pct}% { stroke-dashoffset: ${BAR} }`);
    // A hair past the boundary, never on it: two keyframes at the same stop
    // are one keyframe, and the refill would simply replace the end of the
    // phase that just drained.
    if (pct < 100) {
      keys.push(`${(pct + 0.05).toFixed(3)}% { stroke-dashoffset: 0 }`);
    }
  }
  return `@keyframes wr-breathe-bar { ${keys.join(" ")} }`;
}

/** The pattern named by the stored setting, or the one most people have met. */
export function patternFor(config: unknown): Pattern {
  const name = (config as { pattern?: unknown } | null)?.pattern;
  if (typeof name !== "string") return FALLBACK;
  return PATTERNS[name] ?? FALLBACK;
}

/**
 * The whole interface, as one string.
 *
 * A template literal holding CSS, which has one trap worth knowing before you
 * copy this file: a backtick inside a comment in here ends the literal. It
 * costs a build failure rather than a runtime bug, so it is cheap - but it is
 * confusing the first time, and it has happened twice writing this.
 */
export function markup(pattern: Pattern): string {
  const [inSec, hold1, outSec, hold2] = pattern;
  const cycle = inSec + hold1 + outSec + hold2;
  const pct = (seconds: number) => ((seconds / cycle) * 100).toFixed(3);

  return `
    <style>
      @keyframes wr-breathe {
        0%                                     { transform: scale(.55) }
        ${pct(inSec)}%                         { transform: scale(1) }
        ${pct(inSec + hold1)}%                 { transform: scale(1) }
        ${pct(inSec + hold1 + outSec)}%        { transform: scale(.55) }
        100%                                   { transform: scale(.55) }
      }
      ${barKeyframes(pattern, cycle)}

      /* The host paints the ground behind this frame, and the frame has to
         let it through - both elements, because either one opaque is a
         rectangle around the circle.

         There is no color-scheme: dark here and there must not be. It reads
         like the right thing for a dark session and it is what put the
         rectangle back: WebKit responds to it by painting the frame's canvas
         with its own dark, which is not the host's dark, and no background
         declaration overrides it. Chrome does not, so this was invisible
         everywhere except the packaged app. It buys form-control and
         scrollbar styling that a circle and two words do not have. */
      html, body { background: transparent }

      /* The two colours that read against the host's dim ground. An addon
         cannot reach the app's design tokens from a sandboxed frame, and
         should not - a token is an implementation detail the app is entitled
         to change. */
      body {
        margin: 0;
        display: grid;
        place-items: center;
        gap: 14px;
        color: #d9cfbe;
        font-family: ui-sans-serif, system-ui, sans-serif;
        user-select: none;
      }
      .orb {
        width: ${ORB}px;
        height: ${ORB}px;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 45%, #d9cfbe 0%, #a8977c 70%);
        animation: wr-breathe ${cycle}s ease-in-out infinite;
      }
      .phase { font-size: 22px }
      /* Tight under the word it belongs to, rather than a third thing spaced
         evenly between the others: the bar is the word's countdown, and the
         gap is what says so. */
      .bar { display: block; margin-top: -6px }
      .left { font-size: 13px; opacity: .6 }

      /* Someone who has asked the system for less movement has asked this
         session for less movement. The pacing still works - the word still
         turns at the boundary - it simply stops moving them to do it. */
      @media (prefers-reduced-motion: reduce) {
        .orb { animation: none; transform: scale(.85) }
        .bar-fill { animation: none }
      }
    </style>

    <div class="orb"></div>

    <div class="phase" aria-live="polite">${LABELS[0]}</div>

    <svg class="bar" aria-hidden="true"
         width="${BAR_BOX.width}" height="${BAR_BOX.height}"
         viewBox="0 0 ${BAR_BOX.width} ${BAR_BOX.height}">
      <line x1="1" y1="2" x2="${BAR + 1}" y2="2"
            stroke="rgba(217, 207, 190, .12)" stroke-width="1.5"
            stroke-linecap="round" />
      <line class="bar-fill" x1="1" y1="2" x2="${BAR + 1}" y2="2"
            stroke="rgba(217, 207, 190, .5)" stroke-width="1.5"
            stroke-linecap="round" stroke-dasharray="${BAR}"
            style="animation: wr-breathe-bar ${cycle}s linear infinite" />
    </svg>

    <div class="left"></div>
  `;
}
