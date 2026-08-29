import { Button } from "@wiseroutine/design";
import { useEffect } from "react";
import { chime } from "../../lib/chime";
import { clock } from "./session-clock";

/**
 * The frame every session shares: a full-window ground, a countdown, and the
 * two ways out.
 *
 * Here rather than repeated in each module because these are the parts that
 * must not vary. A session that ends differently depending on which activity
 * it was is a session people learn twice, and "finished" and "gave up" have to
 * stay two distinct answers - collapsing them is what turns a progress number
 * into a lie.
 */

export const SessionFrame: React.FC<{
  /** What is running, in two or three words. */
  title: string;
  /** The countdown, or whatever the module wants in its place. */
  meter?: React.ReactNode;
  /** "Done" unless the module has a better word for finishing. */
  doneLabel?: string;
  onDone: () => void;
  onSkip: () => void;
  children?: React.ReactNode;
  /** A darker ground, for a session about looking away from the screen. */
  dim?: boolean;
}> = ({
  title,
  meter,
  doneLabel = "Done",
  onDone,
  onSkip,
  children,
  dim = false,
}) => {
  // One note when the frame appears, one when it goes. In the shared frame
  // rather than in each module, so a session cannot ship without them and
  // cannot ship with two.
  useEffect(() => {
    chime("start");
    return () => chime("end");
  }, []);

  return (
    <div
      // Not a modal: there is nothing behind this worth reaching, and a session
      // you can click out of by accident is one you lose.
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // `wr-session-dim` re-points one token, and only one - see the note
      // beside it in app.css.
      className={dim ? "wr-session-dim" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 40,
        textAlign: "center",
        background: dim ? "#14120f" : "var(--wr-page)",
        color: dim ? "#f6f1e8" : "var(--color-text)",
      }}
    >
      <div
        style={{
          font: "400 13px var(--font-body)",
          letterSpacing: ".06em",
          textTransform: "uppercase",
          opacity: 0.65,
        }}
      >
        {title}
      </div>

      {meter}
      {children}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Button variant="commit" onClick={onDone}>
          {doneLabel}
        </Button>
        {/* Quiet, and honestly labelled. A session abandoned halfway is a skip,
          and dressing it up as anything else would put a stretch nobody did
          into this week's numbers. */}
        <Button variant="quiet" onClick={onSkip}>
          Stop
        </Button>
      </div>
    </div>
  );
};

/** The big digits every timed session shows. */
export const Countdown: React.FC<{ seconds: number; dim?: boolean }> = ({
  seconds,
  dim,
}) => (
  <div
    // Tabular figures, or the whole block shifts left and right as the digits
    // change and the eye reads it as movement rather than time.
    style={{
      font: "400 64px/1 var(--font-heading)",
      fontVariantNumeric: "tabular-nums",
      color: dim ? "#f6f1e8" : "var(--color-text)",
    }}
    aria-live="off"
  >
    {clock(seconds)}
  </div>
);
