import {
  Button,
  Chip,
  clockOf,
  Metric,
  StateRow,
  Widget,
} from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { upNextOf } from "../lib/alerts";
import { type ActivityProgress, api, type MissedItem } from "../lib/api";
import { startSlot, usePlan } from "../lib/plan-store";

/**
 * The rail's modules, and which of them a plan is allowed.
 *
 * `/today` already answers with the list - `visibleModules` filters the seven
 * keys down to what the plan permits - so nothing here decides entitlement.
 * This file only knows how to draw each key, and skips any it does not
 * recognise: a module added to the server before it is drawn here should leave
 * a gap, not a crash.
 *
 * The day comes from `lib/plan-store` rather than a fetch of its own. The
 * shell mounts the rail with no props, and a second read of `/today` per
 * reload would cost a round trip and let the rail disagree with the timeline
 * it is standing next to.
 */

/** "1 / 3" for a count, "50 m / 2 h" for a duration. Two readings of the same
 *  row, chosen by the minimum's own type. */
function progressOf(row: ActivityProgress): { value: string; ratio: number } {
  if (row.minimumType === "durationPerDay") {
    const target = row.minimumValue;
    const hours = Math.floor(target / 60);
    const goal =
      hours > 0
        ? `${hours} h${target % 60 ? ` ${target % 60}` : ""}`
        : `${target} m`;
    return {
      value: `${row.minutes} m / ${goal}`,
      ratio: target > 0 ? Math.min(1, row.minutes / target) : 0,
    };
  }
  return {
    value: `${row.count} / ${row.minimumValue}`,
    ratio: row.minimumValue > 0 ? Math.min(1, row.count / row.minimumValue) : 0,
  };
}

/** 3a: the one slot you can start right now. Pinned on every plan, which is
 *  why it is the only module that renders something when there is nothing to
 *  show rather than disappearing. */
const UpNext: React.FC = () => {
  const plan = usePlan();
  // Its own clock: a countdown that only moved when the timeline re-rendered
  // would sit still for up to a minute at a time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!plan) return null;
  const next = upNextOf(plan.slots, now);

  return (
    /* No `count`. The countdown used to sit in the head as a static chip,
       which is upper-cased - so "18m" came out as "18M", and a unit is not an
       abbreviation. It belongs with the time anyway, next to the name of the
       thing it is counting down to. */
    <Widget variant="attention" eyebrow="Up next">
      {next.title ? (
        <>
          <h3 className="wr-widget-title">{next.title}</h3>
          <div className="wr-widget-time">
            {next.badge === "now" ? "Now" : `in ${next.badge}`}
            <span className="wr-widget-time-soft"> · {next.label}</span>
          </div>
          {next.slotId ? (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="commit"
                onClick={() => next.slotId && startSlot(next.slotId)}
              >
                Start now
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="wr-body" style={{ margin: "2px 0 0" }}>
          Nothing left today.
        </p>
      )}
    </Widget>
  );
};

/** 3d: the honest list. Fetched rather than derived, because the reason a slot
 *  was missed lives in its lifecycle log and never reaches the timeline. */
const MissedToday: React.FC = () => {
  const plan = usePlan();
  const [items, setItems] = useState<MissedItem[] | null>(null);

  // Re-read whenever the day is re-read: a slot that has just been missed is
  // exactly the thing this module exists to say.
  useEffect(() => {
    if (!plan) return;
    api
      .missed()
      .then(setItems)
      // A failed read is not "nothing was missed" - showing nothing is the
      // honest answer to a question we could not ask.
      .catch(() => setItems(null));
  }, [plan]);

  if (!items || items.length === 0) return null;

  return (
    <Widget eyebrow="Missed today" count={items.length}>
      {items.map((item) => (
        <div key={item.id} style={{ marginTop: 8 }}>
          <StateRow
            recessed
            name={item.title}
            leading={<Chip variant="static">{dueClock(item.dueAt)}</Chip>}
            trailing={
              <span
                style={{
                  font: "400 11.5px var(--font-body)",
                  color: "var(--wr-text-muted)",
                  textAlign: "right",
                  maxWidth: 104,
                }}
              >
                {item.reasonText ?? reasonOf(item)}
              </span>
            }
          />
        </div>
      ))}
    </Widget>
  );
};

/** The wall clock a slot was due at. `clockOf` speaks minutes-from-midnight,
 *  which is what the rest of the day view uses. */
const dueClock = (at: number): string => {
  const d = new Date(at);
  return clockOf(d.getHours() * 60 + d.getMinutes());
};

/** A sentence for a slot whose log recorded a code but no prose. */
function reasonOf(item: MissedItem): string {
  if (item.status === "skipped") return "You dismissed it";
  if (item.moveCount > 0)
    return `Moved ${item.moveCount === 1 ? "once" : `${item.moveCount} times`}, then no gap`;
  return "No gap it would fit in";
}

/** 3a: progress against your minimums. Never a streak, never a goal. */
const TodaySoFar: React.FC = () => {
  const plan = usePlan();
  // A day restored from the offline cache may predate this field - see
  // `TodayResponse`. Nothing to report is the same as no module.
  const rows = plan?.progress ?? [];
  if (rows.length === 0) return null;

  return (
    <Widget eyebrow="Today so far">
      {rows.map((row) => {
        const { value, ratio } = progressOf(row);
        return (
          <Metric
            key={row.id}
            label={row.name}
            value={value}
            progress={ratio}
            tone={row.kind === "focus" ? "focus" : "recovery"}
          />
        );
      })}
    </Widget>
  );
};

export const DashboardWidgets: React.FC = () => {
  const plan = usePlan();
  if (!plan) return null;

  return (
    <>
      {plan.modules.map((key) => {
        switch (key) {
          case "up_next":
            return <UpNext key={key} />;
          case "missed_today":
            return <MissedToday key={key} />;
          case "today_so_far":
            return <TodaySoFar key={key} />;
          // The four Pro keys the server already returns and nothing here
          // draws yet. Listed rather than left to the default so that the gap
          // is visible to whoever reads this next - and rendered as nothing
          // rather than as a placeholder, because "Coming soon" four times
          // over is a worse rail than three modules and some space.
          case "start_something_now":
          case "sitting_streak":
          case "tomorrows_shape":
          case "reminders_due":
            return null;
          default:
            return null;
        }
      })}
    </>
  );
};
