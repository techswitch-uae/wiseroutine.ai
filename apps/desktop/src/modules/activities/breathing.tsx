import { SelectField } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import type { ActivityModule, ConfigProps } from "./index";
import { SessionFrame } from "./session-chrome";
import { useEndsAt } from "./session-clock";

/**
 * A pacer to breathe along with.
 *
 * The circle is the whole interface: it grows on the in-breath, holds, shrinks
 * on the out-breath, holds again. No numbers counting down inside it, because
 * watching a number is not the same activity as breathing.
 *
 * ponytail: the animation is one CSS keyframe with its duration computed from
 * the pattern, not a requestAnimationFrame loop. The browser already
 * interpolates on the compositor; driving it from JavaScript would cost a
 * frame budget to arrive at the same circle, and would stutter the moment
 * anything else on the page did work.
 */

/** In, hold, out, hold - seconds. Every pattern worth having is four numbers. */
export interface BreathingConfig {
  pattern: readonly [number, number, number, number];
}

export const PATTERNS: Record<string, BreathingConfig["pattern"]> = {
  /** Box breathing. The one most people have met. */
  "box 4-4-4-4": [4, 4, 4, 4],
  /** Longer out than in, which is the half that settles you. */
  "4-7-8": [4, 7, 8, 0],
  /** Coherent breathing - five and five, no holds. */
  "coherent 5-5": [5, 0, 5, 0],
};

const DEFAULTS: BreathingConfig = {
  pattern: PATTERNS["box 4-4-4-4"] as BreathingConfig["pattern"],
};

const nameOf = (pattern: BreathingConfig["pattern"]): string =>
  Object.entries(PATTERNS).find(
    ([, value]) => value.join("-") === pattern.join("-"),
  )?.[0] ?? "box 4-4-4-4";

/** Which phase of the cycle a given second falls in, and how far through. */
export function phaseAt(
  pattern: BreathingConfig["pattern"],
  elapsedSeconds: number,
): { label: string; index: number } {
  const total = pattern.reduce((a, b) => a + b, 0);
  const labels = ["Breathe in", "Hold", "Breathe out", "Hold"];
  if (total <= 0) return { label: labels[0] as string, index: 0 };

  let t = elapsedSeconds % total;
  for (const [index, seconds] of pattern.entries()) {
    // A zero-length phase is skipped rather than shown for an instant: "4-7-8"
    // has no closing hold, and flashing the word would be a lie about the
    // pattern.
    if (seconds > 0 && t < seconds) {
      return { label: labels[index] as string, index };
    }
    t -= seconds;
  }
  return { label: labels[0] as string, index: 0 };
}

/**
 * The ring around the circle, and how much of this phase is left in it.
 *
 * The ask was a countdown per phase that is not a number: watching digits is
 * not the same activity as breathing, and neither is counting dots. So the
 * ring is drawn full at the start of each phase and drains to nothing by the
 * end of it - four seconds of "in" and eight of "out" read as the same shape
 * moving at two speeds, which is the thing being taught.
 *
 * ponytail: the same trick as the circle - one keyframe set computed from the
 * pattern, `linear` because time is, animated on the compositor. No timer, no
 * per-frame state, and it cannot fall out of step with the circle beside it
 * because both are one animation on the same clock.
 */
const RADIUS = 124;
const RING = 2 * Math.PI * RADIUS;

export function ringKeyframes(
  pattern: BreathingConfig["pattern"],
  cycle: number,
): string {
  const at = (seconds: number): string => ((seconds / cycle) * 100).toFixed(3);
  const keys = ["0% { stroke-dashoffset: 0 }"];
  let elapsed = 0;

  for (const seconds of pattern) {
    // A phase the pattern does not have - "4-7-8" has no closing hold - is not
    // an instant of empty ring.
    if (seconds <= 0) continue;
    elapsed += seconds;
    const pct = Number(at(elapsed));
    keys.push(`${pct}% { stroke-dashoffset: ${RING.toFixed(2)} }`);
    // A hair past the boundary, never on it: two keyframes at the same stop
    // are one keyframe, and the refill would simply replace the end of the
    // phase that just drained.
    if (pct < 100)
      keys.push(`${(pct + 0.05).toFixed(3)}% { stroke-dashoffset: 0 }`);
  }
  return `@keyframes wr-breathe-ring { ${keys.join(" ")} }`;
}

const BreathingSession: React.FC<{
  slot: { endsAt: number; startsAt: number };
  config: BreathingConfig;
  onDone: () => void;
  onSkip: () => void;
}> = ({ slot, config, onDone, onSkip }) => {
  const left = useEndsAt(slot.endsAt, onDone);
  /**
   * Seconds since the circle started moving, read from the clock rather than
   * counted up.
   *
   * The word and the circle are two clocks describing one breath: the circle
   * is a CSS animation on real time, and a counter that added one per interval
   * fell behind it - every late tick was kept - until "Breathe out" was being
   * said over a circle already filling. Four ticks a second so the word turns
   * at the phase boundary rather than up to a second after it.
   */
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setElapsed((Date.now() - startedAt) / 1_000),
      250,
    );
    return () => clearInterval(timer);
  }, [startedAt]);

  const [inSec, hold1, outSec, hold2] = config.pattern;
  const cycle = inSec + hold1 + outSec + hold2;
  const { label } = phaseAt(config.pattern, elapsed);

  return (
    <SessionFrame
      dim
      title="Breathing"
      doneLabel="Done early"
      onDone={onDone}
      onSkip={onSkip}
      meter={
        <>
          <style>{`
            @keyframes wr-breathe {
              0%                                { transform: scale(.55) }
              ${(inSec / cycle) * 100}%         { transform: scale(1) }
              ${((inSec + hold1) / cycle) * 100}%  { transform: scale(1) }
              ${((inSec + hold1 + outSec) / cycle) * 100}% { transform: scale(.55) }
              100%                              { transform: scale(.55) }
            }
            ${ringKeyframes(config.pattern, cycle)}
          `}</style>
          <div
            style={{
              position: "relative",
              width: 2 * RADIUS + 12,
              height: 2 * RADIUS + 12,
              display: "grid",
              placeItems: "center",
            }}
          >
            {/* Rotated so the ring empties from the top, which is where an eye
                that is not really looking expects a clock to start. */}
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${2 * RADIUS + 12} ${2 * RADIUS + 12}`}
              style={{
                position: "absolute",
                inset: 0,
                transform: "rotate(-90deg)",
              }}
            >
              <circle
                cx={RADIUS + 6}
                cy={RADIUS + 6}
                r={RADIUS}
                fill="none"
                stroke="rgba(217, 207, 190, .12)"
                strokeWidth={1.5}
              />
              <circle
                cx={RADIUS + 6}
                cy={RADIUS + 6}
                r={RADIUS}
                fill="none"
                stroke="rgba(217, 207, 190, .5)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray={RING}
                style={{
                  animation: `wr-breathe-ring ${cycle}s linear infinite`,
                }}
              />
            </svg>
            <div
              style={{
                width: 220,
                height: 220,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle at 50% 45%, #d9cfbe 0%, #a8977c 70%)",
                // Steps computed from the pattern, so changing 4-4-4-4 to 4-7-8
                // changes the motion and nothing else.
                animation: `wr-breathe ${cycle}s ease-in-out infinite`,
              }}
            />
          </div>
        </>
      }
    >
      <div style={{ font: "400 22px var(--font-heading)" }}>{label}</div>
      <div style={{ font: "400 13px var(--font-body)", opacity: 0.6 }}>
        {Math.ceil(left / 60)} min left
      </div>
    </SessionFrame>
  );
};

const BreathingConfigForm: React.FC<ConfigProps<BreathingConfig>> = ({
  value,
  onChange,
}) => (
  <SelectField
    label="Pattern"
    options={Object.keys(PATTERNS)}
    value={nameOf(value.pattern)}
    onChange={(event) =>
      onChange({
        pattern:
          PATTERNS[event.target.value] ??
          (PATTERNS["box 4-4-4-4"] as BreathingConfig["pattern"]),
      })
    }
  />
);

export const breathing: ActivityModule<BreathingConfig> = {
  key: "breathing",
  name: "Breathing",
  blurb:
    "a circle paces your breathing for the whole slot - box, 4-7-8 or coherent",
  defaults: { sessionMinutes: 3, startPolicy: "manual", config: DEFAULTS },
  parse: (raw) => {
    const pattern = (raw as BreathingConfig | null)?.pattern;
    const ok =
      Array.isArray(pattern) &&
      pattern.length === 4 &&
      pattern.every((n) => typeof n === "number" && n >= 0 && n <= 60) &&
      pattern.reduce((a: number, b: number) => a + b, 0) > 0;
    return ok ? { pattern: pattern as BreathingConfig["pattern"] } : DEFAULTS;
  },
  Config: BreathingConfigForm,
  Session: BreathingSession,
};
