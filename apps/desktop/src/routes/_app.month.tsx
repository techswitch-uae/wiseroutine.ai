import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DayBar,
  isoOf,
  MonthGrid,
  monthCellsOf,
  ScopeNav,
} from "@wiseroutine/design";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getSessionToken, type ScopeResponse } from "../lib/api";
import { fullDate, monthKey, monthLabel, monthOf, todayOf } from "../lib/scope";
import { monthCellsFrom } from "../lib/scope-view";

/** The day, the week and the month all settle the same way after a sync -
 *  see `_app.index`. */
const SETTLE_MS = [1_200, 4_000, 10_000];

/**
 * Month - one dot per slot, so a whole month reads at a glance.
 *
 * Filled dot for a slot taken, hollow for one still planned, and a count of
 * the day's meetings beside the date. Meetings get the count rather than a
 * third dot: how booked a day was is the question a month answers, and which
 * meetings is a question for the day.
 */
const Month: React.FC = () => {
  const navigate = useNavigate();
  const { m } = Route.useSearch();

  const today = todayOf();
  const { year, month } = monthOf(m, today);
  const atToday = year === today.getFullYear() && month === today.getMonth();

  // Six Monday-first rows, neighbouring months included - so the request is
  // for the grid, not for the month, and the leading and trailing days carry
  // their dots like any other.
  const cells = monthCellsOf(year, month, today);

  const [data, setData] = useState<ScopeResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // `monthCellsOf` always answers with 42 cells; the fallback is for the
  // compiler, not for a case that happens.
  const firstIso = cells[0]?.iso ?? isoOf(today);
  const span = cells.length;

  const load = useCallback(() => {
    if (!getSessionToken()) return () => undefined;
    let live = true;
    api
      .scope(firstIso, span)
      .then((answer) => {
        if (live) setData(answer);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [firstIso, span]);

  useEffect(load, [load]);

  const latest = useRef(load);
  latest.current = load;
  const settling = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** The same settle cadence as the day and the week - `POST /sync` schedules
   *  and returns, so one look straight after it lands on nothing. */
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

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const go = (step: number | null) => {
    const at = new Date(year, month + (step ?? 0), 1);
    void navigate({
      to: "/month",
      search:
        step === null ? {} : { m: monthKey(at.getFullYear(), at.getMonth()) },
      replace: true,
    });
  };

  return (
    <>
      <DayBar
        date={monthLabel(year, month)}
        syncing={syncing}
        syncedAt={data?.syncedAt ?? null}
        now={now}
        onRefresh={refresh}
        nav={
          <ScopeNav
            atToday={atToday}
            unit="month"
            onBack={() => go(-1)}
            onToday={() => go(null)}
            onForward={() => go(1)}
          />
        }
      />

      <div className="wr-page-scroll">
        <MonthGrid
          cells={monthCellsFrom(cells, data)}
          // Why an early month can be empty: nothing from before a calendar
          // was connected was ever fetched. Omitted when none is - the
          // sentence would then raise a question rather than answer one.
          {...(data?.meetingsFrom
            ? { meetingsFrom: fullDate(data.meetingsFrom) }
            : {})}
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

export const Route = createFileRoute("/_app/month")({
  // The grid is measured in days across; a 250px column of kept-clear
  // space beside it is a narrower Thursday - see `lib/rail`.
  staticData: { fullWidth: true },
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.m === "string" ? { m: search.m } : {},
  component: Month,
});
