import { Chip, Field } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { openExternal } from "../../lib/open-external";
import type { ActivityModule, ConfigProps } from "./index";
import { Countdown, SessionFrame } from "./session-chrome";
import { useCountdown } from "./session-clock";

/**
 * A focus block, and the one sentence that makes it one.
 *
 * Screen 4a. The intention field is the load-bearing part: a 25-minute timer
 * with nothing written on it is a 25-minute timer, and what turns it into a
 * block of work is having said out loud what the block is for. It is asked
 * before the clock starts, once, and then sits there.
 *
 * Music is a link, not an integration. "Play and start" opens whatever the
 * user pasted - a Spotify playlist, an album, a radio stream - in the app that
 * owns it, and starts the session in the same press.
 *
 * ponytail: a URL, not the Spotify Web API. The API would let the session
 * pause the music at the end, and costs an OAuth flow, a token refresh, a
 * Premium requirement and a second thing that can be disconnected. Add it when
 * someone asks for pause-on-break; until then this is twenty lines and works
 * with every music app there is.
 *
 * The blocking row from 4a - Slack muted, mail paused, sites blocked - needs
 * macOS Accessibility permission and is a Pro feature. It is shown here as
 * what it is: something this session does not do yet.
 */

export interface DeepWorkConfig {
  /** Opened when the session starts. Empty means no music. */
  musicUrl: string;
}

const DEFAULTS: DeepWorkConfig = { musicUrl: "" };

/** Only what a browser will hand to another app. A `javascript:` or `file:`
 *  URL in a settings field is not a playlist. */
const OPENABLE = /^(https?|spotify|music|apple-?music):/i;

const DeepWorkSession: React.FC<{
  slot: { endsAt: number; title: string };
  config: DeepWorkConfig;
  onDone: () => void;
  onSkip: () => void;
}> = ({ slot, config, onDone, onSkip }) => {
  const left = useCountdown(slot.endsAt);
  const [intention, setIntention] = useState("");
  // Written before the clock is looked at. Once it is set, the field goes and
  // the sentence stays - it is a commitment, not a note to keep editing.
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  const begin = () => {
    setCommitted(true);
    if (OPENABLE.test(config.musicUrl)) void openExternal(config.musicUrl);
  };

  if (!committed) {
    return (
      <SessionFrame
        title={slot.title}
        doneLabel={config.musicUrl ? "Play music & start" : "Start"}
        onDone={begin}
        onSkip={onSkip}
      >
        <p style={{ font: "400 15px/1.5 var(--font-body)", maxWidth: 380 }}>
          One thing, in one line. You will see it for the whole block.
        </p>
        <div style={{ width: 380 }}>
          <Field
            label="What is this block for?"
            value={intention}
            placeholder="get the three tier headlines down, no editing"
            onChange={(event) => setIntention(event.target.value)}
          />
        </div>
      </SessionFrame>
    );
  }

  return (
    <SessionFrame
      title={slot.title}
      meter={<Countdown seconds={left} />}
      doneLabel="Finish now"
      onDone={onDone}
      onSkip={onSkip}
    >
      {intention ? (
        <p
          style={{
            font: "400 20px/1.45 var(--font-body)",
            maxWidth: 460,
            margin: 0,
          }}
        >
          {intention}
        </p>
      ) : null}
      {/* Said plainly rather than implied. Someone who saw this row in the
          designs and does not get a quiet Slack should know why. */}
      <Chip variant="static">Blocking apps and sites is a Pro feature</Chip>
    </SessionFrame>
  );
};

const DeepWorkConfigForm: React.FC<ConfigProps<DeepWorkConfig>> = ({
  value,
  onChange,
}) => (
  <Field
    label="Music to start with (optional)"
    value={value.musicUrl}
    placeholder="https://open.spotify.com/playlist/…"
    onChange={(event) => onChange({ musicUrl: event.target.value })}
  />
);

export const deepWork: ActivityModule<DeepWorkConfig> = {
  key: "deep_work",
  name: "Deep work",
  blurb: "One written intention, a countdown, and your music if you want it.",
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

export { OPENABLE };
