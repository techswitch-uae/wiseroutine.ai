import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  addDays,
  clockOf,
  DayBar,
  isoOf,
  ScopeNav,
  WeekGrid,
  WeekLegend,
  weekDaysOf,
  weekStartOf,
} from "@wiseroutine/design";
import { useAccount } from "../lib/account";
import { dayOf, todayOf, weekLabel } from "../lib/scope";

/**
 * Week - where the gaps are.
 *
 * The scaffold only: seven columns against the account's own hours, and the
 * navigation between weeks. Nothing is placed in it yet - there is no server
 * route that answers for a week, and a grid filled with the day's slots
 * repeated seven times would be a lie rather than a placeholder.
 *
 * ponytail: empty columns until `GET /week` exists. The block shape the grid
 * takes (`WeekBlock`) is what that route has to answer with.
 */
const Week: React.FC = () => {
  const navigate = useNavigate();
  const { start: startParam } = Route.useSearch();
  const user = useAccount();

  const today = todayOf();
  const thisWeek = weekStartOf(today);
  const start = weekStartOf(dayOf(startParam, today));
  const atToday = isoOf(start) === isoOf(thisWeek);

  /** Paging writes the week into the URL; going home takes it back out, so
   *  "this week" is always the parameterless link. */
  const go = (to: Date | null) =>
    void navigate({
      to: "/week",
      search: to ? { start: isoOf(to) } : {},
      replace: true,
    });

  return (
    <>
      <DayBar
        date={weekLabel(start)}
        span={`${clockOf(user?.dayStartMinutes ?? 8 * 60)}–${clockOf(
          user?.dayEndMinutes ?? 18 * 60,
        )}`}
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
          days={weekDaysOf(start, today)}
          startMinutes={user?.dayStartMinutes ?? 8 * 60}
          endMinutes={user?.dayEndMinutes ?? 18 * 60}
          // Today is still the plain `/`, so opening the current column is
          // the same navigation the sidebar's Day entry makes.
          onOpenDay={(iso) =>
            void navigate({
              to: "/",
              search: iso === isoOf(today) ? {} : { date: iso },
            })
          }
        />
        <WeekLegend />
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
