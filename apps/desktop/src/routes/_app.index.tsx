import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  addDays,
  clockOf,
  DAY_DENSITIES,
  DashedRow,
  DayBar,
  DayGrid,
  HoursMenu,
  isoOf,
  Loading,
  OutsideRange,
  ScopeNav,
  Slot,
} from "@wiseroutine/design";
import { useCallback, useEffect, useRef, useState } from "react";
import { upNextOf } from "../lib/alerts";
import {
  ApiError,
  api,
  buildTimeline,
  flushPending,
  getSessionToken,
  type TodayResponse,
} from "../lib/api";
import { setDensity, useDensity } from "../lib/density";
import { notify } from "../lib/notify";
import { pick, usePicked } from "../lib/picked";
import {
  publishMove,
  publishPlan,
  publishReload,
  publishStart,
} from "../lib/plan-store";
import { markStarted } from "../lib/running-slot";
import { dayOf, todayOf } from "../lib/scope";
import { TodayRail } from "../modules/today-rail";
import { DAY_HOURS_ANCHOR } from "./_app.settings";

/** What `api.today()` hands back: the plan plus where it came from. */
type CachedToday = TodayResponse & { stale: boolean; cachedAt: number };

/** How long away from the window counts as long enough to re-sync on return,
 *  rather than merely reloading what the server already had. */
const SYNC_AFTER_AWAY_MS = 20_000;

/**
 * When to look again after asking for a sync.
 *
 * `POST /sync` schedules the work and returns; the fetching happens behind it.
 * One look after a beat was enough for an incremental sync and not nearly
 * enough for the first one after connecting an account, which is a whole
 * calendar's history - so that case showed an empty day and stayed that way
 * until something else remounted the page. Three cheap reads spread over ten
 * seconds covers both without making the user press anything.
 */
const SETTLE_MS = [1_200, 4_000, 10_000];

/** A wall clock time, in the same 24-hour shape the rest of the day uses. */
const hourClock = (at: number): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));

/**
 * Midday on the chosen date, which is what the server is asked for.
 *
 * `GET /today?at=` resolves the local date of an instant against the
 * account's zone, and this browser's zone may not be that one. Noon is the
 * instant furthest from both midnights, so the two agree unless they are more
 * than twelve hours apart - which no pair of real zones is.
 */
const middayOn = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();

const Today: React.FC = () => {
  const navigate = useNavigate();
  /** The day on screen. Absent means today - see `lib/scope`. */
  const { date: dateParam } = Route.useSearch();
  const [data, setData] = useState<CachedToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** How much room an hour gets. Remembered between launches - see
   *  `lib/density.ts`. */
  const density = useDensity();
  const [queued, setQueued] = useState(() => api.pendingCount());
  const [syncing, setSyncing] = useState(false);
  /** The block the rail is describing - see `lib/picked`. Held there rather
   *  than here because the rail is mounted by the shell, not by this page. */
  const picked = usePicked();

  /**
   * Which hours are on screen, for as long as this window is open.
   *
   * Deliberately not saved. Switching to the evening to check something is
   * looking, not a preference - the range the day *starts* on is a setting,
   * and it lives in Settings where it can be seen and changed on purpose.
   * Null means "whatever the server opens on", which is what the first load
   * asks for and what the server answers with.
   */
  const [range, setRange] = useState<string | null>(null);

  const today = todayOf();
  const viewed = dayOf(dateParam, today);
  /** Rule 2, on the day: there is nothing behind today to go back to. */
  const atToday = isoOf(viewed) === isoOf(today);

  /**
   * Move to another day, or home.
   *
   * `null` drops the parameter rather than writing today's date into it, so
   * today is always the plain `/` - which is what the sidebar's Day entry
   * links to, and what makes rule 1 true without either side knowing about
   * the other. `replace`, because paging through a week is one act of looking
   * and should not cost seven presses of the back button to undo.
   */
  const goTo = (date: Date | null) => {
    // The picked block belongs to the day it was picked on; carrying it across
    // would leave the rail describing a slot that is no longer on screen.
    pick(null);
    void navigate({
      to: "/",
      search: date ? { date: isoOf(date) } : {},
      replace: true,
    });
  };

  const load = useCallback(() => {
    if (!getSessionToken()) {
      setError("not_connected");
      return;
    }
    api
      .today({
        ...(range ? { range } : {}),
        // Omitted on today, so the request is the one it has always been and
        // the server's own clock decides which day that is.
        ...(dateParam ? { at: middayOn(dayOf(dateParam, new Date())) } : {}),
      })
      .then((response) => {
        setData(response);
        setQueued(api.pendingCount());
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError && cause.status === 401
            ? "not_connected"
            : "offline",
        );
      });
  }, [range, dateParam]);

  /**
   * Sync now, then show what arrived.
   *
   * The server schedules and queues; the work itself finishes just after the
   * response. So this waits a beat before reloading rather than reloading
   * immediately onto data that has not landed yet. Anything slower than that
   * is picked up by the next load - no press is ever lost, it just may show up
   * a moment later than the spinner suggests.
   */
  const lastSync = useRef(0);
  /** Outstanding settle timers, so leaving the page does not leave them
   *  running and setting state on a component that has gone. */
  const settling = useRef<ReturnType<typeof setTimeout>[]>([]);

  /**
   * The current `load`, for anything that runs later than the render it was
   * set up in.
   *
   * `load` closes over the chosen range, so a timer holding the copy it was
   * created with reloads the range that *was* on screen. That is exactly what
   * happened: switching to the full day was silently undone a second later by
   * the settle timers of a sync asked for before the switch, and it looked
   * like the picker had ignored the click.
   */
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  /** The plan as it stands, for the menu bar listeners - which are set up once
   *  and would otherwise act on whatever day was on screen at mount. */
  const dataRef = useRef<CachedToday | null>(null);
  useEffect(() => {
    dataRef.current = data;
    // The rail is mounted by the shell and cannot be handed props, so the day
    // is published rather than passed - see `lib/plan-store`.
    publishPlan(data);
  }, [data]);

  const refresh = useCallback(() => {
    lastSync.current = Date.now();
    setSyncing(true);

    for (const timer of settling.current) clearTimeout(timer);
    settling.current = [];

    api
      .sync()
      .catch(() => undefined)
      .finally(() => {
        settling.current = SETTLE_MS.map((delay) =>
          setTimeout(() => {
            // The spinner belongs to the first look; the later ones are
            // catching up quietly and should not make the button flicker.
            if (delay === SETTLE_MS[0]) setSyncing(false);
            latest.current();
          }, delay),
        );
      });
  }, []);

  useEffect(
    () => () => {
      for (const timer of settling.current) clearTimeout(timer);
    },
    [],
  );

  useEffect(load, [load]);

  /**
   * Catch up when the window comes back.
   *
   * Connecting a calendar finishes in a browser, so this window is not
   * involved and learns nothing on its own. Without this the day stayed as it
   * was until something else happened to remount it - which is why connecting
   * an account appeared to do nothing until you visited Calendars and came
   * back.
   *
   * A reload alone is not enough, either. The connect callback *queues* the
   * first sync rather than running it, so the events are still arriving when
   * the window regains focus and a straight reload would land on an empty day.
   * Coming back after a while therefore syncs and then reloads, the same thing
   * the refresh button does.
   *
   * Throttled, because alt-tabbing is not a request for a sync. Inside the
   * window, a plain reload still picks up anything the server already has.
   */
  useEffect(() => {
    const caughtUp = () => {
      if (Date.now() - lastSync.current > SYNC_AFTER_AWAY_MS) refresh();
      else latest.current();
    };

    globalThis.addEventListener?.("focus", caughtUp);
    return () => globalThis.removeEventListener?.("focus", caughtUp);
  }, [refresh]);

  /**
   * Send anything taken offline, then reload.
   *
   * On mount as well as on `online`, because the browser fires that event on
   * regaining a network - not on the app being reopened somewhere with one.
   */
  useEffect(() => {
    const drain = () => {
      void flushPending().then((sent) => {
        setQueued(api.pendingCount());
        if (sent > 0) load();
      });
    };

    drain();
    globalThis.addEventListener?.("online", drain);
    return () => globalThis.removeEventListener?.("online", drain);
  }, [load]);

  /**
   * The live slot is decided by the clock, so the timeline has to re-render as
   * it passes.
   *
   * Not the now line, though - that keeps its own clock inside the grid, so
   * moving it no longer costs a render of the whole day.
   *
   * Aligned to the minute rather than a plain interval started at mount. An
   * unaligned one fires at whatever second the page happened to load, which
   * left a slot going live up to 59 seconds after it actually did.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const atNextMinute = () => {
      timer = setTimeout(
        () => {
          const at = Date.now();
          setNow(at);
          /**
           * A slot that starts itself is started by the *server*, and nothing
           * here would ever hear about it.
           *
           * So an eye rest set to run on its own came due, the sweep started
           * it, and this window went on drawing it as planned until something
           * else happened to re-read the day - which is why pressing its play
           * button looked like the only way to make a session appear.
           *
           * Terminating on purpose: once the day says `started`, the
           * condition is false and this stops asking.
           */
          const due = dataRef.current?.slots.some(
            (slot) =>
              slot.startPolicy === "auto" &&
              slot.status === "planned" &&
              slot.startsAt <= at,
          );
          if (due) latest.current();
          atNextMinute();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    atNextMinute();
    return () => clearTimeout(timer);
  }, []);

  /**
   * Put a slot somewhere else, by hand.
   *
   * Optimistic, because the grid has already drawn the drop and putting the
   * block back for a round trip would read as the drag failing. A refusal
   * reloads, which is the only honest correction: the server's answer is the
   * plan, not ours.
   *
   * The move also pins the slot server-side, so the next replan leaves it
   * where it was put - see `moveSlot`.
   */
  const move = useCallback((key: string, startsAt: number, endsAt: number) => {
    setData(
      (current) =>
        current && {
          ...current,
          slots: current.slots.map((slot) =>
            slot.id === key
              ? { ...slot, startsAt, endsAt, isLocked: true }
              : slot,
          ),
        },
    );

    api.moveSlot(key, startsAt, endsAt).catch(() => {
      notify("Couldn't move that. Putting it back.");
      latest.current();
    });
  }, []);

  /**
   * Begin a slot. Shared, because the menu bar can start one too and both
   * presses have to reach the same offline queue.
   *
   * Optimistic, and that is the whole point. A session used to appear only
   * once the round trip had landed and the day had been re-read, so on a slow
   * answer the press did nothing visible - and if anything at all went wrong
   * on the way back, the server had recorded the start and the app had not,
   * which is exactly the state you find by reloading and landing straight in
   * a session you did not think you had started. Now the press changes the
   * day in hand, and the server's answer either confirms it or takes it back.
   */
  const start = useCallback((slotId: string) => {
    // This run opened it, so this run may show its session - see
    // `lib/running-slot`. Marked before the request, because the optimistic
    // status below is what the overlay reads.
    markStarted(slotId);

    setData(
      (current) =>
        current && {
          ...current,
          slots: current.slots.map((slot) =>
            slot.id === slotId ? { ...slot, status: "started" as const } : slot,
          ),
        },
    );

    api
      .startSlot(slotId)
      .then(({ queued: waiting }) => {
        setQueued(api.pendingCount());
        // Offline there is nothing to reload from, and the queue is projected
        // onto every later read - so the optimistic status above is not a
        // guess, it is what the next answer will say too.
        if (!waiting) latest.current();
      })
      .catch(() => {
        // Never silent. This used to have no catch at all: a refusal became an
        // unhandled rejection, the day was never re-read, and the block sat
        // there looking startable.
        notify("Couldn't start that just now.");
        latest.current();
      });
  }, []);

  useEffect(() => publishStart(start), [start]);
  useEffect(() => publishMove(move), [move]);
  useEffect(() => publishReload(() => latest.current()), []);

  /**
   * Take a slot off today, with one way back.
   *
   * Optimistic, because Delete has to feel like Delete. The undo is not a
   * courtesy: this is a destructive action taken on a bare keypress, with no
   * dialog in front of it, and a confirmation on every press would defeat the
   * shortcut it was confirming. So the toast carries the way back instead.
   *
   * Today only, and that falls out of the model rather than being arranged: a
   * cancelled slot is still a row, and the server re-plans an activity that has
   * *no* slot today - so this stays gone until tomorrow rather than reappearing
   * on the next page load.
   */
  const remove = useCallback((slotId: string, title: string) => {
    const drop = (id: string) =>
      setData(
        (current) =>
          current && {
            ...current,
            slots: current.slots.filter((slot) => slot.id !== id),
          },
      );

    drop(slotId);
    api
      .cancelSlot(slotId)
      .then(() => {
        notify(`${title} removed from today.`, {
          label: "Undo",
          onClick: () => {
            void api
              .restoreSlot(slotId)
              .then(() => latest.current())
              .catch(() => notify("Couldn't put that back. Try again."));
          },
        });
      })
      .catch(() => {
        notify("Couldn't remove that. Putting it back.");
        latest.current();
      });
  }, []);

  /* The day said out loud - the menu bar and the notifications - is armed by
     the shell now, from today's plan rather than from this page's. It was
     here, and so it stopped the moment anyone opened the week or Settings,
     leaving the menu bar announcing a slot that had long since run. See
     `useMenuBar` in `_app.tsx`. */

  /**
   * Presses that arrived from the menu bar rather than the window.
   *
   * The menu carries no state of its own, so "Start now" means "start whatever
   * `upNextOf` last called up next" - worked out here, from the same plan the
   * menu was rendered from.
   */
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;

    let stop: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      stop = await Promise.all([
        listen("tray://start", () => {
          // The menu says "start what's next", and next means today. If the
          // window happens to be showing another day, that day's plan is not
          // an answer to it - better to do nothing than to start something
          // scheduled for a week away.
          const plan = dataRef.current;
          const at = Date.now();
          if (!plan || at < plan.dayStart || at >= plan.dayEnd) return;
          const next = upNextOf(plan.slots, at);
          if (next?.slotId) start(next.slotId);
        }),
        // The pause itself is applied in `tray.rs`, where the press lands and
        // where the clock that honours it runs. This draws the toast, and is
        // told when the quiet ends rather than working it out - one definition
        // of an hour, not two.
        listen<number>("tray://pause", (event) => {
          notify(
            `Quiet until ${hourClock(event.payload)}. The day carries on.`,
          );
        }),
      ]);
    });

    return () => {
      for (const off of stop) off();
    };
  }, [start]);

  if (!data) {
    return (
      <Loading>
        {error === "offline"
          ? "Can't reach Wise Routine right now."
          : "Loading your day…"}
      </Loading>
    );
  }

  const rows = buildTimeline(data, now);
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: data.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(data.dayStart));

  /**
   * The window, written the way the picker writes it.
   *
   * From the range's own minutes rather than by formatting `dayEnd`, because
   * the full day ends at the next midnight and formats as "00:00" - a header
   * reading "00:00–00:00" for the widest possible view. Minutes-from-midnight
   * has a 24:00 and an instant does not.
   */
  const active = data.ranges.find((r) => r.key === data.range);
  const hoursLabel = active
    ? `${clockOf(active.startMinutes)}–${
        active.endMinutes >= 24 * 60 ? "24:00" : clockOf(active.endMinutes)
      }`
    : "";

  return (
    <>
      {data.stale ? (
        <SavedPlanNotice cachedAt={data.cachedAt} queued={queued} />
      ) : null}

      <DayBar
        hours={
          <HoursMenu
            ranges={data.ranges}
            value={data.range}
            onChange={setRange}
            densities={DAY_DENSITIES}
            density={density.key}
            onDensityChange={setDensity}
            onEdit={() =>
              void navigate({ to: "/settings", hash: DAY_HOURS_ANCHOR })
            }
          />
        }
        date={dayLabel}
        span={hoursLabel}
        nav={
          <ScopeNav
            atToday={atToday}
            unit="day"
            onBack={() => goTo(addDays(viewed, -1))}
            onToday={() => goTo(null)}
            onForward={() => goTo(addDays(viewed, 1))}
          />
        }
        syncing={syncing}
        syncedAt={data.syncedAt}
        now={now}
        onRefresh={refresh}
      />

      <div className="wr-page-scroll">
        {data.outside.before.length > 0 ? (
          <OutsideRange
            edge="before"
            count={data.outside.before.length}
            at={active ? clockOf(active.startMinutes) : ""}
            onExpand={() => setRange("full")}
          />
        ) : null}

        {rows.length === 0 ? (
          // The only empty day left: nothing has been added to place. Anything
          // that exists is placed the moment this page is opened - see
          // `fillDay` on the Worker - so there is no "press to plan" here to
          // press.
          <DashedRow
            gutter={false}
            onClick={() => void navigate({ to: "/activities" })}
          >
            Nothing on today yet - add an activity
          </DashedRow>
        ) : (
          <DayGrid
            dayStart={data.dayStart}
            dayEnd={data.dayEnd}
            timeZone={data.timeZone}
            // Pressing the day itself puts the rail's card away. The blocks
            // stop the press before it gets here, so this is only ever the
            // empty parts of the grid.
            onBackdrop={() => pick(null)}
            // Both halves of the density, never one. The scale and the floor
            // are the same decision, and splitting them is how a day ends up
            // with every block drawn at the same lie - see `DayDensity`.
            quarterStep={density.quarterStep}
            minBlockHeight={density.minBlockHeight}
            onMove={move}
            items={rows.map((row) => ({
              key: row.key,
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              movable: row.movable === true,
              title: row.title,
              // Every block, meetings included: "what is this and what can I
              // do about it" is a fair question to ask of a block you cannot
              // move, and the answer is worth giving.
              onSelect: () => pick(row.key),
              selected: row.key === picked,
              // Enter and Delete, for a block that has focus. A finished slot
              // offers neither: there is nothing left to start, and taking it
              // off the day would erase what actually happened.
              ...(row.slotId && row.done !== true
                ? {
                    onStart: () => row.slotId && start(row.slotId),
                    onRemove: () => row.slotId && remove(row.slotId, row.title),
                  }
                : {}),
              node: (
                <Slot
                  variant={row.variant}
                  // The gutter already says when this is; repeating it inside
                  // the card is noise the grid was built to remove.
                  time=""
                  name={row.title}
                  meta={row.meta ?? ""}
                  done={row.done ?? false}
                  // Stopped, not unstarted. The rail says the same thing in
                  // words - see `slotState`.
                  action={row.resumable === true ? "resume" : "start"}
                  // No grace bar or "moves itself" line inside the grid: those
                  // are list-row affordances, and here they make a 25-minute
                  // block draw twice its own height and collide with the next.
                  onStart={() => {
                    if (row.slotId) start(row.slotId);
                  }}
                />
              ),
            }))}
          />
        )}

        {data.outside.after.length > 0 ? (
          <OutsideRange
            edge="after"
            count={data.outside.after.length}
            at={active ? clockOf(active.endMinutes) : ""}
            onExpand={() => setRange("full")}
          />
        ) : null}
      </div>
    </>
  );
};

/**
 * Shown only when the plan on screen came from storage rather than the server.
 *
 * A stale plan presented as current is worse than an error - someone would
 * follow a routine that has since been replanned around a meeting they cannot
 * see. Saying when it was saved lets them judge that themselves.
 */
const SavedPlanNotice: React.FC<{ cachedAt: number; queued: number }> = ({
  cachedAt,
  queued,
}) => (
  <div
    role="status"
    style={{
      background: "var(--wr-recessed)",
      border: "1px solid var(--wr-hairline)",
      borderRadius: 12,
      padding: "9px 12px",
      marginBottom: 12,
      font: "500 12.5px var(--font-body)",
      color: "var(--wr-text-muted)",
    }}
  >
    Offline - showing the plan saved at{" "}
    {new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(cachedAt))}
    {queued > 0
      ? `. ${queued} ${queued === 1 ? "change" : "changes"} will sync when you reconnect.`
      : "."}
  </div>
);

export const Route = createFileRoute("/_app/")({
  /** The day being read, as `YYYY-MM-DD`. Absent is today, and today is never
   *  written down - see `goTo`. */
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.date === "string" ? { date: search.date } : {},
  component: Today,
  // The one page the set-up module belongs on: it is the empty day behind it
  // that makes the ask make sense. Calendars and Account declare nothing and
  // so get no rail at all - asking someone to connect a calendar on the page
  // they are already connecting one from is worse than silence.
  staticData: { rail: TodayRail },
});
