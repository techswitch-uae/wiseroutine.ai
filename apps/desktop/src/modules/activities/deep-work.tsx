import { Field } from "@wiseroutine/design";
import { useEffect } from "react";
import { OPENABLE } from "../../lib/music";
import type { ActivityModule, ConfigProps } from "./index";
import { Player } from "./music-player";
import { Countdown, SessionFrame } from "./session-chrome";
import { useCountdown } from "./session-clock";

/**
 * A focus block: one line, a clock, and whatever you put on to work to.
 *
 * Screen 4a, minus the field and minus the door in front of it. It used to
 * ask what the block was for, and then wait behind a "Play music & start"
 * button before the clock moved - so a session that had already begun sat
 * there looking like it had not. The block is started before this screen
 * exists; the screen's job is to show that, not to ask permission for it.
 *
 * ponytail: a link and an embed, not the Spotify Web API. The API would let
 * the session pause the music at the end, and costs an OAuth flow, a token
 * refresh, a Premium requirement and a second thing that can be disconnected.
 * Add it when someone asks for pause-on-break.
 *
 * The blocking row from 4a - Slack muted, mail paused, sites blocked - needs
 * macOS Accessibility permission and is a Pro feature. Not drawn: a line
 * naming something the session does not do is an advertisement in the middle
 * of a focus block.
 */

/** Why the next twenty-five minutes are worth defending. One line, and it does
 *  not change - a session is not the place to be read something new. */
const CREED = "One thing, until the clock runs out. Everything else can wait.";

export interface DeepWorkConfig {
  /** Played in the session, or opened in the app that owns it. Empty means no
   *  music. */
  musicUrl: string;
}

const DEFAULTS: DeepWorkConfig = { musicUrl: "" };

const DeepWorkSession: React.FC<{
  slot: { endsAt: number; title: string };
  config: DeepWorkConfig;
  onDone: () => void;
  onSkip: () => void;
}> = ({ slot, config, onDone, onSkip }) => {
  const left = useCountdown(slot.endsAt);

  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  return (
    <SessionFrame
      title={slot.title}
      meter={<Countdown seconds={left} />}
      doneLabel="Finish now"
      onDone={onDone}
      onSkip={onSkip}
    >
      <p
        style={{
          font: "400 18px/1.45 var(--font-body)",
          maxWidth: 420,
          margin: 0,
        }}
      >
        {CREED}
      </p>
      {OPENABLE.test(config.musicUrl) ? <Player url={config.musicUrl} /> : null}
    </SessionFrame>
  );
};

const DeepWorkConfigForm: React.FC<ConfigProps<DeepWorkConfig>> = ({
  value,
  onChange,
}) => (
  <Field
    label="Music to work to (optional)"
    value={value.musicUrl}
    placeholder="https://open.spotify.com/playlist/…"
    onChange={(event) => onChange({ musicUrl: event.target.value })}
  />
);

export const deepWork: ActivityModule<DeepWorkConfig> = {
  key: "deep_work",
  name: "Deep work",
  blurb:
    "the block takes over the screen with a countdown, and your music if you have set a link",
  defaults: { sessionMinutes: 25, startPolicy: "manual", config: DEFAULTS },
  parse: (raw) => {
    const url = (raw as DeepWorkConfig | null)?.musicUrl;
    // Kept only if it is something that could be opened. A stored value that
    // fails this is dropped rather than carried around waiting to be clicked.
    return {
      musicUrl: typeof url === "string" && OPENABLE.test(url) ? url : "",
    };
  },
  Config: DeepWorkConfigForm,
  Session: DeepWorkSession,
};
