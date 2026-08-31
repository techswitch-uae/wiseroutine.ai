import { useEffect, useRef, useState } from "react";
import type { ActivityModule } from "./index";
import { SessionFrame } from "./session-chrome";
import { clock, useCountdown, useEndsAt } from "./session-clock";

/**
 * A stretch, one step at a time.
 *
 * Screen 4b: numbered steps, a countdown to the next one, and two ways
 * through - move on now, or stop. Steps rather than a single timer because a
 * ten-minute block labelled "stretch" is a block people spend looking at their
 * phone; four things to do in order is an activity.
 *
 * Steps advance on their own when their time is up. Someone with their arm in
 * a doorway cannot reach the keyboard, which is the entire reason a guided
 * stretch is guided - the button is for going early, not for getting through.
 */

export interface Step {
  text: string;
  seconds: number;
}
export interface StretchConfig {
  steps: readonly Step[];
}

/** The four steps from the design, which are also a genuinely good shoulder
 *  routine for someone who has been at a desk for an hour. */
const DEFAULTS: StretchConfig = {
  steps: [
    { text: "Stand, roll the shoulders back and forth", seconds: 40 },
    { text: "Doorway chest opener, 30s each side", seconds: 60 },
    { text: "Neck side bend, slow, both sides", seconds: 45 },
    { text: "Look out of the window, twenty seconds", seconds: 20 },
  ],
};

const StretchSession: React.FC<{
  slot: { endsAt: number };
  config: StretchConfig;
  onDone: () => void;
  onSkip: () => void;
}> = ({ slot, config, onDone, onSkip }) => {
  const steps = config.steps;
  const total = steps.length;
  const [index, setIndex] = useState(0);
  // A deadline, not a number of ticks. A counter decremented once a second
  // drifts, and a laptop that slept through a step wakes up still counting it.
  const [stepEndsAt, setStepEndsAt] = useState(
    () => Date.now() + (steps[0]?.seconds ?? 30) * 1_000,
  );
  const left = useCountdown(stepEndsAt);
  // The slot's own time running out ends it too, however far through the steps
  // it got. A stretch that overran into the next meeting is not a stretch that
  // worked.
  useEndsAt(slot.endsAt, onDone);

  const step = steps[index];

  /**
   * On to the next step, by hand or by the clock.
   *
   * In a ref, and this is the whole bug: the overlay above re-parses the
   * stored config on every render, so `config.steps` is a new array every
   * second. Anything keyed on it - the old `useEffect([index, config.steps])`
   * - restarted its timer on every tick, which is why the countdown sat near
   * 40 and no step ever ended. The timer below depends on the deadline alone.
   */
  const advance = useRef(() => {});
  advance.current = () => {
    const next = index + 1;
    if (next >= total) return onDone();
    setIndex(next);
    setStepEndsAt(Date.now() + (steps[next]?.seconds ?? 30) * 1_000);
  };

  // One timer per step, aimed at its deadline, fired once.
  useEffect(() => {
    const timer = setTimeout(
      () => advance.current(),
      Math.max(0, stepEndsAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [stepEndsAt]);

  const last = index + 1 >= total;

  if (!step) return null;

  return (
    <SessionFrame
      title={`Step ${index + 1} of ${total}`}
      meter={
        <div>
          <div
            style={{
              font: "400 44px/1 var(--font-heading)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {clock(left)}
          </div>
          {/* The digits alone read as "hold this for 0:24". Saying what runs
              out is the difference between a step and a deadline. */}
          <div
            style={{
              font: "400 13px var(--font-body)",
              letterSpacing: ".04em",
              opacity: 0.65,
              marginTop: 6,
            }}
          >
            {last ? "until this finishes" : "until the next step"}
          </div>
        </div>
      }
      doneLabel={last ? "Finish" : "Next step"}
      onDone={() => advance.current()}
      onSkip={onSkip}
    >
      <p
        style={{
          font: "400 20px/1.45 var(--font-body)",
          maxWidth: 420,
          margin: 0,
        }}
      >
        {step.text}
      </p>

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {steps.map((s, i) => (
          <span
            key={s.text}
            aria-hidden
            style={{
              width: 22,
              height: 3,
              borderRadius: 2,
              background:
                i <= index ? "var(--color-text)" : "var(--wr-hairline)",
            }}
          />
        ))}
      </div>
    </SessionFrame>
  );
};

export const stretch: ActivityModule<StretchConfig> = {
  key: "stretch",
  name: "Guided stretch",
  blurb: "it walks you through the stretch one step at a time, hands-free",
  defaults: { sessionMinutes: 10, startPolicy: "manual", config: DEFAULTS },
  parse: (raw) => {
    const steps = (raw as StretchConfig | null)?.steps;
    const ok =
      Array.isArray(steps) &&
      steps.length > 0 &&
      steps.every(
        (s) =>
          typeof s?.text === "string" &&
          s.text.length > 0 &&
          typeof s.seconds === "number" &&
          s.seconds > 0,
      );
    return ok ? { steps } : DEFAULTS;
  },
  Session: StretchSession,
};
