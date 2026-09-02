import {
  Button,
  Chip,
  clockOf,
  Metric,
  StateRow,
  Widget,
} from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { AddonWidgets } from "../addons/widget";
import { upNextOf } from "../lib/alerts";
import {
  type ActivityProgress,
  api,
  type BucketItem,
  type MissedItem,
} from "../lib/api";
import { notify } from "../lib/notify";
import { reloadPlan, startSlot, usePlan } from "../lib/plan-store";

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

/**
 * What a moved meeting left with nowhere to go.
 *
 * Two kinds of row, and the difference is the whole card. One carries the
 * position `rearrange` would have used but would not apply on its own -
 * because it leaves the activity's window, or moves far enough to be a
 * different plan rather than a nudge - and that row is a question with its
 * answer already in it: one press and it lands there. The other had no
 * position at all, so the only honest offer is to drop it; putting it back
 * needs a time, and the timeline is where a time is chosen.
 *
 * Never a count of what "failed". A session here is one the day genuinely has
 * no room for, and the app saying so is the alternative to it quietly sitting
 * underneath a meeting.
 *
 * Not in `plan.widgets`, on purpose. That list is the four keys the server
 * grants by plan and the user may reorder - and this is not a card anyone
 * chooses to see. A session that has lost its place must be said out loud or
 * it has been lost, so it is appended like an addon's card and draws nothing
 * on a day with an empty bucket, which is most days.
 */
const Bucket: React.FC = () => {
  const plan = usePlan();
  const [items, setItems] = useState<BucketItem[] | null>(null);

  useEffect(() => {
    if (!plan) return;
    api
      .bucket()
      .then(setItems)
      // A read that failed is not an empty bucket. Saying nothing is the
      // honest answer to a question we could not ask.
      .catch(() => setItems(null));
  }, [plan]);

  if (!items || items.length === 0) return null;

  // The day is re-read either way: the server decides whether that stretch is
  // still free, and its answer is the plan - not ours.
  const act = (run: Promise<unknown>, failed: string): void => {
    run.catch(() => notify(failed)).finally(() => reloadPlan());
  };

  return (
    <Widget eyebrow="Nowhere to go" count={items.length}>
      {items.map((item) => (
        <div key={item.id} style={{ marginTop: 8 }}>
          <StateRow
            recessed
            name={item.title}
            meta={`was ${dueClock(item.wasAt)} · ${bucketReason(item)}`}
            leading={<Chip variant="static">{dueClock(item.wasAt)}</Chip>}
            trailing={
              <span style={{ display: "flex", gap: 6 }}>
                {item.suggested ? (
                  <Button
                    variant="primary"
                    onClick={() =>
                      item.suggested &&
                      act(
                        api.moveSlot(
                          item.id,
                          item.suggested.startsAt,
                          item.suggested.endsAt,
                        ),
                        `Couldn't move ${item.title} there.`,
                      )
                    }
                  >
                    {dueClock(item.suggested.startsAt)}
                  </Button>
                ) : null}
                <Button
                  variant="quiet"
                  onClick={() =>
                    act(api.cancelSlot(item.id), `Couldn't drop ${item.title}.`)
                  }
                >
                  Drop
                </Button>
              </span>
            }
          />
        </div>
      ))}
    </Widget>
  );
};

/** Why it is here, in one phrase. The codes are the engine's own; an
 *  unrecognised one still reads as a sentence rather than as a token. */
function bucketReason(item: BucketItem): string {
  if (item.suggested) return "only fits here";
  switch (item.reasonCode) {
    case "no_gap":
      return "no gap it would fit in";
    case "too_close":
      return "too close to another one";
    case "day_over":
      return "the day was over";
    default:
      return "no room left";
  }
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
      {/* Last, and not from `plan.widgets`: the server's list is the four keys
          it grants by plan, and an addon's card is not one of those - it is on
          screen because the user switched that addon on. Which is a decision
          the server does hold, in `addons.is_enabled`; it simply arrives by a
          different route.

          See the note on `AddonWidgets` for why they are appended rather than
          ordered with the rest. */}
      {/* Before the addons and outside `plan.widgets` - see the note on
          `Bucket`. A session with nowhere to go outranks anything optional in
          the rail, and nothing chooses whether to see it. */}
      <Bucket />
      <AddonWidgets />
    </>
  );
};
