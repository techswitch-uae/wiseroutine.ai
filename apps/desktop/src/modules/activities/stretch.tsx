import { Button } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import type { ActivityModule } from "./index";
import { SessionFrame } from "./session-chrome";
import { clock, useEndsAt } from "./session-clock";

/**
 * A stretch, one step at a time.
 *
 * Screen 4b almost exactly: numbered steps, a timer per step, and three ways
 * through - finish this one, skip this one, or stop. Steps rather than a
 * single timer because a ten-minute block labelled "stretch" is a block people
 * spend looking at their phone; four things to do in order is an activity.
 *
 * Steps advance on their own when their time is up. Someone with their arm in
 * a doorway cannot reach the keyboard, which is the entire reason a guided
 * stretch is guided.
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
    { text: "Stand, roll the shoulders back ten times", seconds: 40 },
    { text: "Doorway chest opener, 30 s each side", seconds: 60 },
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
  const total = config.steps.length;
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(config.steps[0]?.seconds ?? 30);
  // The slot's own time running out ends it too, however far through the steps
  // it got. A stretch that overran into the next meeting is not a stretch that
  // worked.
  useEndsAt(slot.endsAt, onDone);

  const step = config.steps[index];

  // One timer for the step, restarted whenever the step changes. Not derived
  // from the slot's clock: skipping a step has to shorten the session, and a
  // step whose end was computed from the start time could not be skipped.
  useEffect(() => {
    setLeft(config.steps[index]?.seconds ?? 30);
    const timer = setInterval(() => setLeft((s) => s - 1), 1_000);
    return () => clearInterval(timer);
  }, [index, config.steps]);

  const next = () => {
    if (index + 1 < total) setIndex(index + 1);
    else onDone();
  };

  // A step whose time is up advances on its own. Someone with their arm in a
  // doorway cannot reach the keyboard, which is the entire reason a guided
  // stretch is guided. Written out rather than calling `next`, so the effect
  // states every value it reads.
  useEffect(() => {
    if (left > 0) return;
    if (index + 1 < total) setIndex(index + 1);
    else onDone();
  }, [left, index, total, onDone]);

  if (!step) return null;

  return (
    <SessionFrame
      title={`Step ${index + 1} of ${total}`}
      meter={
        <div
          style={{
            font: "400 44px/1 var(--font-heading)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {clock(Math.max(0, left))}
        </div>
      }
      doneLabel={index + 1 < total ? "Next step" : "Finish"}
      onDone={next}
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

      {index + 1 < total ? (
        <Button variant="quiet" onClick={() => setIndex(index + 1)}>
          Skip this step
        </Button>
      ) : null}

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {config.steps.map((s, i) => (
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
