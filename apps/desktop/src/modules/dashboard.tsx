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
import {
  type ActivityProgress,
  api,
  type MissedItem,
  type TodaySlot,
} from "../lib/api";
import { startSlot, usePlan } from "../lib/plan-store";

/**
 * The rail's modules, and which of them a plan is allowed.
 *
 * `/today` already answers with the list - `visibleWidgets` filters the seven
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

/**
 * A clock of its own, for the two modules that read the day against one.
 *
 * A countdown - or a "still to go" - that only moved when the timeline
 * re-rendered would sit still for up to a minute at a time, and a block whose
 * window closed would go on being counted as ahead until something else on the
 * page happened to change.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * 3a: the one slot you can start right now.
 *
 * It used to stay pinned on every plan and say "Nothing left today" - the
 * only module that rendered for the sake of rendering. The loudest card in
 * the rail is the wrong place to say nothing: an ink surface with no name and
 * no button on it reads as something failing to load, and it takes the top of
 * the rail from the modules that do have something to say. A day with nothing
 * left says so by not asking.
 */
const UpNext: React.FC = () => {
  const plan = usePlan();
  const now = useNow();

  if (!plan) return null;
  const next = upNextOf(plan.slots, now);
  // Nothing ahead, so nothing to pin. `title` is the test rather than the
  // whole object: `upNextOf` answers `{}` for an empty day, and a next with no
  // name is not something anyone can act on.
  if (!next.title) return null;

  return (
    /* No `count`. The countdown used to sit in the head as a static chip,
       which is upper-cased - so "18m" came out as "18M", and a unit is not an
       abbreviation. It belongs with the time anyway, next to the name of the
       thing it is counting down to. */
    <Widget variant="attention" eyebrow="Up next">
      <h3 className="wr-widget-title">{next.title}</h3>
      <div className="wr-widget-time">
        {next.badge === "now" ? "Now" : `in ${next.badge}`}
        <span className="wr-widget-time-soft"> · {next.label}</span>
      </div>
      {next.slotId ? (
        /* `primary`, not `commit`. Commit fills itself with `--color-text`,
           which is also this card's ground - so the one button on the loudest
           module in the rail was a dark pill on a dark card, readable only by
           its shadow. Starting a slot is a start, which is what `primary` is
           for, and it is what both mocks of this widget draw. */
        <Button
          variant="primary"
          block
          style={{ marginTop: 14 }}
          onClick={() => next.slotId && startSlot(next.slotId)}
        >
          Start now
        </Button>
      ) : null}
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

/** Not dealt with yet. Whether one of these is still ahead of you is a
 *  question about the clock, not about the status - see `tallyOf`. */
const PENDING = new Set(["planned", "live", "started"]);

interface DayTally {
  done: number;
  skipped: number;
  missed: number;
  /** Pending, and still ahead of the clock. */
  ahead: number;
  /** Pending, but its window has closed. Not yours to do anything about, and
   *  never counted as time still to come. */
  overdue: number;
  /** Minutes of completed blocks, and minutes of the ones still ahead. */
  doneMinutes: number;
  aheadMinutes: number;
  /** When the last block still ahead finishes, or null when none is. */
  endsAt: number | null;
}

/**
 * The day, bucketed against the clock.
 *
 * A slot the server has not resolved yet is not automatically "to go": one
 * whose window closed while nobody was looking is in the past, and counting
 * its minutes as time still ahead of you makes the rest of the day look longer
 * than it is. `started` is the exception - a block you are in the middle of is
 * allowed to run past its own end.
 *
 * Cancelled slots are left out entirely - a block that was taken off the day
 * was never something the day failed to do.
 */
function tallyOf(slots: readonly TodaySlot[], now: number): DayTally {
  const t: DayTally = {
    done: 0,
    skipped: 0,
    missed: 0,
    ahead: 0,
    overdue: 0,
    doneMinutes: 0,
    aheadMinutes: 0,
    endsAt: null,
  };
  for (const slot of slots) {
    const minutes = Math.round((slot.endsAt - slot.startsAt) / 60_000);
    if (slot.status === "cancelled") continue;
    if (slot.status === "completed") {
      t.done++;
      t.doneMinutes += minutes;
    } else if (PENDING.has(slot.status)) {
      if (slot.endsAt > now || slot.status === "started") {
        t.ahead++;
        t.aheadMinutes += minutes;
        t.endsAt = Math.max(t.endsAt ?? 0, slot.endsAt);
      } else t.overdue++;
    } else if (slot.status === "skipped") t.skipped++;
    else t.missed++;
  }
  return t;
}

/** "45 m", "2 h", "2 h 10". The same reading the minimums use, so two cards in
 *  one rail do not write the same duration two ways. */
function spanOf(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h${minutes % 60 ? ` ${minutes % 60}` : ""}`;
}

/**
 * The day in one card: what happened, what did not, and what is left.
 *
 * The rail used to go empty on a day with nothing due for hours - `UpNext`
 * stands down when there is no next, and the other three modules each have
 * their own reason to say nothing. This one always has something true to say
 * as long as the day has blocks in it, which is what keeps the rail from
 * reading as something that failed to load.
 *
 * Skipped, missed and overdue are named apart, because they are not the same
 * admission: one you made, one happened to you, and one is still waiting for
 * the server to decide. Neither is scolded and none is hidden - a day where
 * two things did not happen should say so in the same card that says four did.
 *
 * ponytail: derived from the slots the store already holds - no fetch, no new
 * module key. Everything it says is in the timeline standing next to it.
 */
const DayProgress: React.FC = () => {
  const plan = usePlan();
  const now = useNow();
  if (!plan) return null;

  const t = tallyOf(plan.slots, now);
  const total = t.done + t.skipped + t.missed + t.ahead + t.overdue;
  // A day with no blocks is not a day with nothing to report - it is a day
  // this card knows nothing about. Say nothing rather than "0 / 0".
  if (total === 0) return null;

  // Over, not merely quiet: a block whose window closed unresolved is still
  // something the day is waiting on, so it is not a day that is done.
  const settled = t.ahead === 0 && t.overdue === 0;
  const lapsed = [
    t.skipped > 0 ? `${t.skipped} skipped` : null,
    t.missed > 0 ? `${t.missed} missed` : null,
    t.overdue > 0 ? `${t.overdue} overdue` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Widget eyebrow={settled ? "Day done" : "Day so far"}>
      <h3 className="wr-widget-title">
        {settled && t.done === total
          ? "Everything you planned happened"
          : `${t.done} of ${total} done`}
      </h3>
      {/* The same figure in the unit the day is actually spent in. A count
          says how many things; this says how much of the day they were. */}
      <div className="wr-widget-time">
        {spanOf(t.doneMinutes)} done
        {t.aheadMinutes > 0 ? (
          <span className="wr-widget-time-soft">
            {" "}
            · {spanOf(t.aheadMinutes)} to go
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 12 }}>
        <Metric
          label="Done"
          value={`${t.done} / ${total}`}
          progress={t.done / total}
        />
      </div>
      {lapsed || t.ahead > 0 ? (
        <p
          className="wr-body"
          style={{
            margin: "10px 0 0",
            font: "400 12.5px/1.45 var(--font-body)",
          }}
        >
          {lapsed}
          {lapsed && t.ahead > 0 ? ". " : null}
          {t.ahead > 0 && t.endsAt !== null
            ? `${t.ahead === 1 ? "One more" : `${t.ahead} more`}, through ${dueClock(t.endsAt)}`
            : null}
        </p>
      ) : null}
    </Widget>
  );
};

export const DashboardWidgets: React.FC = () => {
  const plan = usePlan();
  if (!plan) return null;

  return (
    <>
      {plan.widgets.map((key) => {
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
      {/* Last, and not from `plan.widgets`: the other four are the server's to
          grant, this one only re-reads the day already on screen. */}
      <DayProgress />
    </>
  );
};
