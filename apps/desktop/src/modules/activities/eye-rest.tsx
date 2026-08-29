import type { ActivityModule } from "./index";
import { Countdown, SessionFrame } from "./session-chrome";
import { useEndsAt } from "./session-clock";

/**
 * Look away from the screen.
 *
 * The one activity where the *screen* is the problem, so the session is mostly
 * an absence: a dark ground, a distance to focus on, and a number big enough
 * to read from across the room. There is nothing to watch here on purpose.
 *
 * `auto` by default. An eye rest you have to press a button for is an eye rest
 * you skip, and the whole point is that it costs nothing to take.
 *
 * ponytail: a fullscreen element in the app's own window, not a macOS
 * screensaver. A real screensaver needs a separate bundle, a system extension
 * and a signing profile, to end up with a dark rectangle and a countdown.
 */

export interface EyeRestConfig {
  /** How far to look, in metres. Twenty feet in the 20-20-20 rule, which is
   *  six metres everywhere that does not measure in feet. */
  metres: number;
}

const DEFAULTS: EyeRestConfig = { metres: 6 };

const EyeRestSession: React.FC<{
  slot: { endsAt: number };
  config: EyeRestConfig;
  onDone: () => void;
  onSkip: () => void;
}> = ({ slot, config, onDone, onSkip }) => {
  // Ends itself. The rest is over when the time is up, and asking someone who
  // has been looking out of a window to come back and confirm it defeats the
  // exercise.
  const left = useEndsAt(slot.endsAt, onDone);

  return (
    <SessionFrame
      dim
      title="Eye rest"
      meter={<Countdown dim seconds={left} />}
      doneLabel="Done early"
      onDone={onDone}
      onSkip={onSkip}
    >
      <p
        style={{
          font: "400 17px/1.5 var(--font-body)",
          maxWidth: 380,
          opacity: 0.8,
        }}
      >
        Look at something about {config.metres} metres away. A window is ideal.
      </p>
    </SessionFrame>
  );
};

export const eyeRest: ActivityModule<EyeRestConfig> = {
  key: "eye_rest",
  name: "Eye rest",
  blurb:
    "the screen dims for the whole slot and asks your eyes to find something far away",
  defaults: { sessionMinutes: 5, startPolicy: "auto", config: DEFAULTS },
  parse: (raw) => {
    const metres = Number((raw as EyeRestConfig | null)?.metres);
    return { metres: Number.isFinite(metres) && metres > 0 ? metres : 6 };
  },
  Session: EyeRestSession,
};
