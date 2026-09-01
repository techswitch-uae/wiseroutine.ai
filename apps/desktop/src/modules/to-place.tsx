import {
  Button,
  type DayScale,
  StateRow,
  scaleFor,
  Widget,
} from "@wiseroutine/design";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/account";
import { api } from "../lib/api";
import { useDensity } from "../lib/density";
import { dropTimeOf } from "../lib/drop-time";
import { notify } from "../lib/notify";
import { owedToday } from "../lib/owed";
import { type Placement, setPlacing, usePlacing } from "../lib/placing";
import { reloadPlan, usePlan } from "../lib/plan-store";

/**
 * What a day still owes, and two ways to put it there.
 *
 * The free plan's placement, and deliberately not a row hidden between two
 * meetings. Offering "31 min free at 23:29 - place here" beside every gap made
 * the timeline argue with itself: most gaps are not somewhere anyone wants a
 * stretch, and the ones at the edges of the day were actively silly. Filling
 * the day is one decision about the whole day, so it is one button, in the
 * rail, next to what it is going to place.
 *
 * The other way is by hand: drag a row onto the timeline and it lands where
 * you dropped it. That is the half this card was missing - it named what the
 * day owed and then offered exactly one way to deal with it, which is fine
 * until you want the stretch after lunch rather than wherever the scheduler
 * would have put it. One row is one session, so a two-session activity is
 * dragged twice and its count comes down each time.
 *
 * Nothing here is materialised in advance. Pressing the button runs the
 * scheduler for the rest of today only - which is also the answer to what a
 * month or a year view would place, namely nothing.
 *
 * On Pro the day is already filled by the time this could render, so it
 * quietly never appears.
 */

/** The drop target, which the page owns and this module only has to find. One
 *  day is on screen at a time, so the class is the whole address. */
const GRID = ".wr-daygrid";

/** One session, where it was dropped. The day is re-read either way: the
 *  server decides whether that gap was really free, and its answer is the
 *  plan - not ours. */
function place(at: Placement): void {
  if (at.startsAt === null) return;
  api
    .placeSlot(at.activityId, at.startsAt, at.startsAt + at.minutes * 60_000)
    .catch(() => notify(`Couldn't put ${at.name} there.`))
    .finally(() => reloadPlan());
}

export const ToPlace: React.FC = () => {
  const plan = usePlan();
  const account = useAccount();
  const density = useDensity();
  const [placing, setPlacingState] = useState(false);
  /**
   * The drag, where the timeline can see it.
   *
   * Held in a store rather than in this component because the grid draws the
   * preview and the grid belongs to the page - see `lib/placing`. The card
   * under the cursor and the outline where it would land are the grid's own,
   * which is the only way they can be *exactly* what moving a slot looks like.
   */
  const drag = usePlacing();
  /**
   * The same drag, for the listeners.
   *
   * They are attached once and outlive every render the drag causes, and the
   * drop must not read state through a closure that is one move out of date.
   * A ref rather than the store's own snapshot so the release is decided by
   * what was true at the moment of it.
   */
  const held = useRef<Placement | null>(null);
  held.current = drag;

  /** What the drop needs from a render that may since have been replaced. */
  const latest = useRef({ scale: null as DayScale | null, dayEnd: 0 });
  latest.current = {
    scale: plan ? scaleFor(density, plan.dayStart) : null,
    dayEnd: plan?.dayEnd ?? 0,
  };

  // Attached for the length of the drag rather than for each position of it:
  // the drag changes on every move, and re-subscribing per frame would swap
  // the window's listeners under the pointer they are following.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;

    const point = (event: PointerEvent) => {
      const current = held.current;
      if (!current) return;
      const { scale, dayEnd } = latest.current;
      const grid =
        document.querySelector(GRID)?.getBoundingClientRect() ?? null;
      setPlacing({
        ...current,
        x: event.clientX,
        y: event.clientY,
        startsAt: scale
          ? dropTimeOf(
              { x: event.clientX, y: event.clientY },
              grid,
              scale,
              dayEnd,
              current.minutes,
            )
          : null,
      });
    };

    /**
     * Released, and placed at most once.
     *
     * This used to run inside the state updater that cleared the drag, which
     * React calls twice in development to catch exactly this - so one drop
     * placed two sessions, and dragging the first of two breathing blocks put
     * both of them on the day. The request belongs out here, where releasing
     * once means placing once.
     */
    const drop = () => {
      const current = held.current;
      held.current = null;
      setPlacing(null);
      // Released off the day: a cancel, and not worth a message.
      if (current?.startsAt != null) place(current);
    };

    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      held.current = null;
      setPlacing(null);
    };

    globalThis.addEventListener("pointermove", point);
    globalThis.addEventListener("pointerup", drop);
    globalThis.addEventListener("keydown", cancel);
    return () => {
      globalThis.removeEventListener("pointermove", point);
      globalThis.removeEventListener("pointerup", drop);
      globalThis.removeEventListener("keydown", cancel);
    };
  }, [dragging]);

  /**
   * Owed by the day on screen, not by today.
   *
   * `progress` comes from `/today?at=`, so it already counts the viewed day's
   * sessions and the ones already placed on it - which is why this card is
   * worth keeping while paging forward, and why nothing it says may call that
   * day "today".
   */
  const owed = owedToday(plan?.progress ?? []);
  if (!plan || owed.length === 0) return null;

  const total = owed.reduce((sum, row) => sum + row.left, 0);

  const fill = () => {
    setPlacingState(true);
    api
      // The day on screen, not the day it is. Its midpoint, because the
      // server only needs some instant inside it and the bounds it was given
      // are the visible range rather than midnight to midnight.
      .plan("user_request", Math.round((plan.dayStart + plan.dayEnd) / 2))
      .then(({ placed, unplaced }) => {
        // Said out loud when the day could not take everything. Silence here
        // reads as "done", and the tray still standing there afterwards with
        // two items left in it reads as the button not working.
        if (unplaced.length > 0) {
          notify(
            placed > 0
              ? `Placed ${placed}. No room today for ${unplaced.length} more.`
              : "No gaps big enough today.",
          );
        }
      })
      .catch(() => notify("Couldn't fill the day just now."))
      .finally(() => {
        setPlacingState(false);
        reloadPlan();
      });
  };

  return (
    <Widget eyebrow="To place" count={total}>
      {owed.map((row) => (
        <div key={row.id} style={{ marginTop: 8 }}>
          <StateRow
            recessed
            name={row.name}
            meta={`${row.minutes} min · ${row.left} of ${row.of}`}
            // The grip is the whole affordance: rows in this card are the one
            // place in the app where something is picked up rather than
            // pressed, and a row that only reveals that on being dragged is a
            // row nobody drags.
            leading={
              <span
                className="wr-grip"
                style={{ cursor: "grab", touchAction: "none" }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  // Stops the browser sweeping a text selection across the
                  // page under the drag.
                  event.preventDefault();
                  setPlacing({
                    activityId: row.id,
                    name: row.name,
                    kind: row.kind,
                    minutes: row.minutes,
                    startsAt: null,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                ⋮⋮
              </span>
            }
            trailing={null}
          />
        </div>
      ))}

      <div style={{ marginTop: 12 }}>
        <Button variant="commit" onClick={fill} disabled={placing}>
          {placing ? "Finding gaps…" : "Place them for me"}
        </Button>
      </div>

      <p
        className="wr-body"
        style={{
          margin: "10px 0 0",
          font: "400 12.5px/1.45 var(--font-body)",
        }}
      >
        Drag one onto a free stretch on this day, or have them placed for you.
      </p>

      {account?.plan === "free" ? (
        <p className="wr-body" style={{ marginTop: 6, marginBottom: 0 }}>
          Pro does this each morning, and again whenever a meeting moves.
        </p>
      ) : null}
    </Widget>
  );
};
