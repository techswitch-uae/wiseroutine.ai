import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  addDays,
  clockOf,
  DayBar,
  HoursMenu,
  isoOf,
  ScopeNav,
  WeekGrid,
  weekDaysOf,
  weekStartOf,
} from "@wiseroutine/design";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getSessionToken, type ScopeResponse } from "../lib/api";
import { dayOf, todayOf, weekLabel } from "../lib/scope";
import { weekDaysFrom } from "../lib/scope-view";
import { DAY_HOURS_ANCHOR } from "./_app.settings";

/** When to look again after asking for a sync - the day's own cadence, and
 *  for the same reason: `POST /sync` schedules and returns, and the fetching
 *  happens behind it. See `_app.index`. */
const SETTLE_MS = [1_200, 4_000, 10_000];

/**
 * Week - where the gaps are.
 *
 * Seven columns against the hours on screen, filled from `GET /scope`:
 * meetings from the connected calendars sit back, your own slots come forward,
 * and anything all-day goes in the strip above the grid.
 *
 * The hours are the day's own picker, answering for seven days at once. It has
 * to be here rather than only on the day: the week is where "when am I free?"
 * is actually asked, and a week locked to working hours cannot answer it for
 * anyone whose evening is the part in question.
 *
 * The scaffold is drawn before the answer arrives and is never redrawn by it -
 * which day is today and which are past are facts about the calendar, not
 * about the data, and a week that reflowed on load would flicker for no gain.
 */
const Week: React.FC = () => {
  const navigate = useNavigate();
  const { start: startParam } = Route.useSearch();

  const today = todayOf();
  const thisWeek = weekStartOf(today);
  const start = weekStartOf(dayOf(startParam, today));
  const atToday = isoOf(start) === isoOf(thisWeek);

  const [data, setData] = useState<ScopeResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /** Which hours are on screen, for as long as this window is open - the same
   *  rule as the day: looking at the evening is looking, not a preference. */
  const [range, setRange] = useState<string | null>(null);

  const startIso = isoOf(start);

  const load = useCallback(() => {
    if (!getSessionToken()) return () => undefined;
    // The week paged away from must not land in the week paged to. An abort
    // flag rather than a cancelled request: the answer is cheap, and what
    // matters is only that a stale one never reaches state.
    let live = true;
    api
      .scope(startIso, 7, range)
      .then((answer) => {
        if (live) setData(answer);
      })
      // No offline copy behind this, unlike the day - see `api.scope`. An
      // empty week reads as "nothing placed", which is the honest answer when
      // there is nothing to show it.
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [startIso, range]);

  useEffect(load, [load]);

  /** The current `load`, for the settle timers - they outlive the render that
   *  set them up, and the one they captured would reload the old week. */
  const latest = useRef(load);
  latest.current = load;
  const settling = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refresh = useCallback(() => {
    setSyncing(true);
    for (const timer of settling.current) clearTimeout(timer);
    settling.current = [];

    api
      .sync()
      .catch(() => undefined)
      .finally(() => {
        settling.current = SETTLE_MS.map((delay) =>
          setTimeout(() => {
            // The spinner belongs to the first look; the later ones catch up
            // quietly rather than making the button flicker.
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

  /** Only so "synced 2 min ago" ages while the window sits open. */
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  /** Paging writes the week into the URL; going home takes it back out, so
   *  "this week" is always the parameterless link. */
  const go = (to: Date | null) =>
    void navigate({
      to: "/week",
      search: to ? { start: isoOf(to) } : {},
      replace: true,
    });

  /**
   * The window on screen.
   *
   * From the range's own minutes rather than the account's settings, so the
   * picker and the grid cannot disagree - and the full day ends at 24:00,
   * which is a minute-of-day and not a time an instant can be formatted as.
   */
  const active = data?.ranges.find((r) => r.key === data.range);
  const startMinutes = active?.startMinutes ?? 8 * 60;
  const endMinutes = active?.endMinutes ?? 18 * 60;

  return (
    <>
      <DayBar
        hours={
          data ? (
            <HoursMenu
              ranges={data.ranges}
              value={data.range}
              onChange={setRange}
              onEdit={() =>
                void navigate({ to: "/settings", hash: DAY_HOURS_ANCHOR })
              }
            />
          ) : null
        }
        date={weekLabel(start)}
        span={`${clockOf(startMinutes)}–${
          endMinutes >= 24 * 60 ? "24:00" : clockOf(endMinutes)
        }`}
        syncing={syncing}
        syncedAt={data?.syncedAt ?? null}
        now={now}
        onRefresh={refresh}
        nav={
          <ScopeNav
            atToday={atToday}
            unit="week"
            onBack={() => go(addDays(start, -7))}
            onToday={() => go(null)}
            onForward={() => go(addDays(start, 7))}
          />
        }
      />

      <div className="wr-page-scroll">
        <WeekGrid
          days={weekDaysFrom(weekDaysOf(start, today), data, {
            startMinutes,
            endMinutes,
          })}
          startMinutes={startMinutes}
          endMinutes={endMinutes}
          // Today is still the plain `/`, so opening the current column is
          // the same navigation the sidebar's Day entry makes.
          onOpenDay={(iso) =>
            void navigate({
              to: "/",
              search: iso === isoOf(today) ? {} : { date: iso },
            })
          }
        />
      </div>
    </>
  );
};

export const Route = createFileRoute("/_app/week")({
  // The grid is measured in days across; a 250px column of kept-clear
  // space beside it is a narrower Thursday - see `lib/rail`.
  staticData: { fullWidth: true },
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.start === "string" ? { start: search.start } : {},
  component: Week,
});
