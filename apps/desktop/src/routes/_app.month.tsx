import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DayBar,
  isoOf,
  MonthGrid,
  monthCellsOf,
  ScopeNav,
} from "@wiseroutine/design";
import { monthKey, monthLabel, monthOf, todayOf } from "../lib/scope";

/**
 * Month - one dot per slot, so a whole month reads at a glance.
 *
 * The grid only: six Monday-first rows, today marked, days before it drawn
 * as settled. The dots are what a month is *for*, and they arrive with the
 * server route that can count them.
 *
 * ponytail: no dots until `GET /month` exists. `MonthCell.taken` and
 * `.planned` are the two numbers it has to answer with per day.
 */
const Month: React.FC = () => {
  const navigate = useNavigate();
  const { m } = Route.useSearch();

  const today = todayOf();
  const { year, month } = monthOf(m, today);
  const atToday = year === today.getFullYear() && month === today.getMonth();

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
          cells={monthCellsOf(year, month, today)}
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
