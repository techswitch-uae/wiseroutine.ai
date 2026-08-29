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

const BreathingSession: React.FC<{
  slot: { endsAt: number; startsAt: number };
  config: BreathingConfig;
  onDone: () => void;
  onSkip: () => void;
}> = ({ slot, config, onDone, onSkip }) => {
  const left = useEndsAt(slot.endsAt, onDone);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

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
          `}</style>
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
