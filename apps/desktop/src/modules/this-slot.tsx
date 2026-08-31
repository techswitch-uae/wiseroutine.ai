import { Button, TimeStepper, Widget } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { api, type TodayResponse } from "../lib/api";
import { notify } from "../lib/notify";
import { pick, usePicked } from "../lib/picked";
import { moveSlotTo, reloadPlan, startSlot, usePlan } from "../lib/plan-store";
import { slotState } from "../lib/slot-state";
import { moduleFor } from "./activities";

/**
 * The block you just pressed, and everything you can do to it.
 *
 * The timeline is a shape, not a control panel: a block whose height is five
 * minutes has room for its name and one button, which left starting, nudging
 * and finishing a slot spread between a 20px play button, a keyboard shortcut
 * nobody is told about, and a drag. This is where those live, at a size you
 * can hit.
 *
 * First in the rail and closable, because it is the only module the user
 * opens: the others describe the day and go quiet on their own.
 *
 * It holds an id rather than a slot - see `lib/picked`. Everything below is
 * read out of the plan as it currently stands, so a block that moves, starts
 * or finishes while it is open says so rather than describing the copy it was
 * handed.
 */

/** How far one press of the stepper moves a block. The ruler the day is drawn
 *  on, so a nudge always lands on a line. */
const STEP_MINUTES = 5;

const clock = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
    {children}
  </div>
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    className="wr-body"
    style={{
      marginTop: 8,
      marginBottom: 0,
      font: "400 12.5px/1.45 var(--font-body)",
    }}
  >
    {children}
  </p>
);

/** A meeting: someone else's block, and we never write back to the calendar it
 *  came from. So there is nothing to do to it - only something to say. */
const Meeting: React.FC<{
  meeting: TodayResponse["meetings"][number];
  timeZone: string;
  leaving: boolean;
  onClose: () => void;
}> = ({ meeting, timeZone, leaving, onClose }) => (
  <Widget eyebrow="This block" leaving={leaving} onClose={onClose}>
    <h3 className="wr-widget-title">{meeting.title ?? "Busy"}</h3>
    <div className="wr-widget-time">
      {clock(meeting.startsAt, timeZone)}–{clock(meeting.endsAt, timeZone)}
    </div>
    <Note>
      From your calendar. Wise Routine plans around this one and never writes
      back to it, so it can only be moved where it came from.
    </Note>
  </Widget>
);

/** As long as the card takes to collapse - see `useWidgetEntrance`. */
const LEAVE_MS = 200;

/** How often the card re-reads the clock. What is true of a block changes as
 *  its window closes - see `slotState` - and a card that only re-rendered when
 *  the plan did would go on offering Start for a minute after the moment
 *  passed. */
const TICK_MS = 30_000;

export const ThisSlot: React.FC = () => {
  const plan = usePlan();
  const picked = usePicked();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);
  /**
   * Closed, but still on screen.
   *
   * Unmounting on the press takes the card's height with it and everything
   * below jumps up. Held for the length of the collapse instead, which is the
   * only part of this the widget cannot do for itself: it does not own the
   * state that decides whether it exists.
   *
   * Held here rather than behind the X, because the X is not the only way the
   * card is put away: pressing the day behind the rail, or paging to another
   * day, clears the selection too - see `pick`. Those went straight from a
   * full card to nothing. Watching the id go null covers every one of them,
   * and it is less code than the timer it replaces.
   */
  const [shown, setShown] = useState(picked);
  const leaving = picked === null && shown !== null;
  useEffect(() => {
    if (picked !== null) {
      setShown(picked);
      return;
    }
    if (shown === null) return;
    const timer = setTimeout(() => setShown(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [picked, shown]);

  const close = () => pick(null);

  if (!plan || !shown) return null;

  const meeting = plan.meetings.find((m) => m.id === shown);
  if (meeting) {
    return (
      <Meeting
        meeting={meeting}
        timeZone={plan.timeZone}
        leaving={leaving}
        onClose={close}
      />
    );
  }

  const slot = plan.slots.find((s) => s.id === shown);
  // Gone: removed, replanned out, or the day rolled over. Saying nothing is
  // the right answer - there is no block to describe any more.
  if (!slot) return null;

  const state = slotState(slot, now);
  const minutes = Math.round((slot.endsAt - slot.startsAt) / 60_000);
  const module = moduleFor(slot.presetKey);

  const nudge = (direction: -1 | 1) => {
    const by = direction * STEP_MINUTES * 60_000;
    moveSlotTo(slot.id, slot.startsAt + by, slot.endsAt + by);
  };

  /** Finishing a plain slot, which nothing else offers. A slot with a session
   *  is finished from inside it; one without had no way to be finished at
   *  all once it was started. */
  /**
   * Record what happened, and always say something back.
   *
   * The `queued` answer used to be thrown away. An action that could not be
   * sent was written to the queue and reported to nobody: no toast, because
   * nothing rejected, and no visible change unless the optimistic pass
   * happened to redraw the card. A press that produces no acknowledgement at
   * all is indistinguishable from a dead button, and it is the one outcome a
   * button must never have.
   */
  const finish = (how: "complete" | "skip") => {
    const action = how === "complete" ? api.completeSlot : api.skipSlot;
    void action(slot.id)
      .then(({ queued }) => {
        if (queued)
          notify(
            how === "complete"
              ? "Saved offline. It will be marked done when you reconnect."
              : "Saved offline. It will sync when you reconnect.",
          );
      })
      .catch(() =>
        notify(
          "Couldn't record that just now. It will sync when you reconnect.",
        ),
      )
      .finally(() => reloadPlan());
  };

  return (
    <Widget eyebrow="This block" leaving={leaving} onClose={close}>
      <h3 className="wr-widget-title">{slot.title}</h3>
      <div className="wr-widget-time">
        {clock(slot.startsAt, plan.timeZone)}–
        {clock(slot.endsAt, plan.timeZone)}
        <span className="wr-widget-time-soft"> · {minutes} min</span>
      </div>

      <Note>{state.note}</Note>

      {/* What pressing Start is actually going to do. A session takes the
          whole window over, and that is worth knowing before you press it. */}
      {module && state.startable ? (
        <Note>When it starts, {module.blurb}.</Note>
      ) : null}

      {state.movable ? (
        <div style={{ marginTop: 12 }}>
          <TimeStepper
            value={clock(slot.startsAt, plan.timeZone)}
            note={`${STEP_MINUTES} min at a time`}
            onStep={nudge}
          />
        </div>
      ) : null}

      <Row>
        {state.startable ? (
          <Button variant="primary" onClick={() => startSlot(slot.id)}>
            {slot.status === "skipped" ? "Resume" : "Start"}
          </Button>
        ) : null}
        {/* Quiet on purpose, and the last thing in the row.
            Ticking a block off without doing it has to be possible - you did
            the stretch away from the desk, or you did it an hour ago - but the
            session is the thing worth entering, and a Done button as loud as
            Start is an invitation to skip the part that matters. */}
        {state.startable || state.running || state.unresolved ? (
          <Button variant="quiet" onClick={() => finish("complete")}>
            Mark it done
          </Button>
        ) : null}
        {/* Stopping a running block that has no session of its own. One that
            has a session is stopped from inside it, and two ways to end the
            same thing is how "done" and "gave up" start disagreeing. */}
        {state.running && !module?.Session ? (
          <Button variant="quiet" onClick={() => finish("skip")}>
            Stop
          </Button>
        ) : null}
        {/* The other half of an unresolved block. "Stop" would be a lie about
            something that stopped hours ago on its own, and "Resume" - which
            is what this used to offer - proposes carrying on with a stretch of
            the day that has already gone. The only honest question left is
            whether it happened. */}
        {state.unresolved ? (
          <Button variant="quiet" onClick={() => finish("skip")}>
            It didn't happen
          </Button>
        ) : null}
      </Row>
    </Widget>
  );
};
