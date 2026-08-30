import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DayBar, ScopeNav, YearGrid, yearMonthsOf } from "@wiseroutine/design";
import { monthKey, todayOf, yearOf } from "../lib/scope";

/**
 * Year - twelve months of rhythm, and a way to jump.
 *
 * The one screen that never places anything: it reads history and opens a
 * month. Which is why every card here is a link and nothing on it is
 * draggable.
 *
 * ponytail: empty week bars until there is a route that answers with a share
 * of daily minimums met per week - `YearMonth.weeks` is that shape.
 */
const Year: React.FC = () => {
  const navigate = useNavigate();
  const { y } = Route.useSearch();

  const today = todayOf();
  const year = yearOf(y, today);
  const atToday = year === today.getFullYear();

  const go = (step: number | null) =>
    void navigate({
      to: "/year",
      search: step === null ? {} : { y: String(year + step) },
      replace: true,
    });

  return (
    <>
      <DayBar
        date={String(year)}
        span="Share of daily minimums met, week by week"
        nav={
          <ScopeNav
            atToday={atToday}
            unit="year"
            onBack={() => go(-1)}
            onToday={() => go(null)}
            onForward={() => go(1)}
          />
        }
      />

      <div className="wr-page-scroll">
        <YearGrid
          months={yearMonthsOf(year, today)}
          onOpenMonth={(month) =>
            void navigate({
              to: "/month",
              search: { m: monthKey(year, month) },
            })
          }
        />
      </div>
    </>
  );
};

export const Route = createFileRoute("/_app/year")({
  // The grid is measured in days across; a 250px column of kept-clear
  // space beside it is a narrower Thursday - see `lib/rail`.
  staticData: { fullWidth: true },
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.y === "string" ? { y: search.y } : {},
  component: Year,
});
