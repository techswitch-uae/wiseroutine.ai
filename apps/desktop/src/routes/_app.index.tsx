import { createFileRoute } from "@tanstack/react-router";
import {
  DashedRow,
  DayGrid,
  IconButton,
  RefreshGlyph,
  Slot,
} from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
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
  const refresh = useCallback(() => {
    setSyncing(true);
    api
      .sync()
      .then(() => new Promise((resolve) => setTimeout(resolve, 1200)))
      .catch(() => undefined)
      .finally(() => {
        setSyncing(false);
        load();
      });
  }, [load]);

  useEffect(load, [load]);

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
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>
            {dayLabel}
          </span>
          <span
            style={{
              font: "600 12px var(--font-body)",
              color: "var(--wr-text-muted)",
            }}
          >
            {rows.filter((r) => r.variant === "recovery").length} recovery slots
            found
          </span>
        </div>
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
