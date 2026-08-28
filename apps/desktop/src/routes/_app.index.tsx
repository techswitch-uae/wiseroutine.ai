import { createFileRoute } from "@tanstack/react-router";
import {
  DashedRow,
  DayGrid,
  IconButton,
  RefreshGlyph,
  Slot,
} from "@wiseroutine/design";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  buildTimeline,
  flushPending,
  getSessionToken,
  type TodayResponse,
} from "../lib/api";
import { SetupRail } from "../modules/setup-rail";

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
 * calendar's history — so that case showed an empty day and stayed that way
 * until something else remounted the page. Three cheap reads spread over ten
 * seconds covers both without making the user press anything.
 */
const SETTLE_MS = [1_200, 4_000, 10_000];

const Today: React.FC = () => {
  const [data, setData] = useState<CachedToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [queued, setQueued] = useState(() => api.pendingCount());
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    if (!getSessionToken()) {
      setError("not_connected");
      return;
    }
    api
      .today()
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
  }, []);

  /**
   * Sync now, then show what arrived.
   *
   * The server schedules and queues; the work itself finishes just after the
   * response. So this waits a beat before reloading rather than reloading
   * immediately onto data that has not landed yet. Anything slower than that
   * is picked up by the next load — no press is ever lost, it just may show up
   * a moment later than the spinner suggests.
   */
  const lastSync = useRef(0);
  /** Outstanding settle timers, so leaving the page does not leave them
   *  running and setting state on a component that has gone. */
  const settling = useRef<ReturnType<typeof setTimeout>[]>([]);

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
            load();
          }, delay),
        );
      });
  }, [load]);

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
   * was until something else happened to remount it — which is why connecting
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
      else load();
    };

    globalThis.addEventListener?.("focus", caughtUp);
    return () => globalThis.removeEventListener?.("focus", caughtUp);
  }, [load, refresh]);

  /**
   * Send anything taken offline, then reload.
   *
   * On mount as well as on `online`, because the browser fires that event on
   * regaining a network — not on the app being reopened somewhere with one.
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

  // The live slot is decided by the clock, so the timeline has to re-render as
  // it passes. A minute is enough — nothing here changes faster than that.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!data) {
    return (
      <p className="wr-body">
        {error === "offline"
          ? "Can't reach Wise Routine right now."
          : "Loading your day…"}
      </p>
    );
  }

  const rows = buildTimeline(data, now);
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: data.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(data.dayStart));

  return (
    <>
      {data.stale ? (
        <SavedPlanNotice cachedAt={data.cachedAt} queued={queued} />
      ) : null}

      <header className="wr-shell-head wr-shell-head-bar wr-page-bar">
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>
          {dayLabel}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconButton
            label={syncing ? "Syncing your calendars" : "Sync calendars now"}
            busy={syncing}
            disabled={syncing}
            onClick={refresh}
          >
            <RefreshGlyph />
          </IconButton>
        </div>
      </header>

      <div className="wr-page-scroll">
        {rows.length === 0 ? (
          <DashedRow gutter={false}>
            Nothing planned yet — plan your day
          </DashedRow>
        ) : (
          <DayGrid
            dayStart={data.dayStart}
            dayEnd={data.dayEnd}
            timeZone={data.timeZone}
            now={now}
            items={rows.map((row) => ({
              key: row.key,
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              node: (
                <Slot
                  variant={row.variant}
                  // The gutter already says when this is; repeating it inside
                  // the card is noise the grid was built to remove.
                  time=""
                  name={row.title}
                  meta={row.meta ?? ""}
                  done={row.done ?? false}
                  // No grace bar or "moves itself" line inside the grid: those
                  // are list-row affordances, and here they make a 25-minute
                  // block draw twice its own height and collide with the next.
                  onStart={() => {
                    if (!row.slotId) return;
                    void api
                      .startSlot(row.slotId)
                      .then(({ queued: waiting }) => {
                        setQueued(api.pendingCount());
                        // Offline there is nothing to reload from; the queue is
                        // already projected onto what is on screen.
                        if (!waiting) load();
                        else setData((current) => current && { ...current });
                      });
                  }}
                />
              ),
            }))}
          />
        )}
      </div>
    </>
  );
};

/**
 * Shown only when the plan on screen came from storage rather than the server.
 *
 * A stale plan presented as current is worse than an error — someone would
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
    Offline — showing the plan saved at{" "}
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
  component: Today,
  // The one page the set-up module belongs on: it is the empty day behind it
  // that makes the ask make sense. Calendars and Account declare nothing and
  // so get no rail at all — asking someone to connect a calendar on the page
  // they are already connecting one from is worse than silence.
  staticData: { rail: SetupRail },
});
