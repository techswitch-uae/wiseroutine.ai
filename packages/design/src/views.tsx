import type React from "react";
import {
  type MonthCell,
  SCOPES,
  type Scope,
  type WeekDay,
  type YearMonth,
} from "./calendar";
import { IconButton } from "./components";
import { clockOf } from "./time";

/**
 * The calendar's four scopes, and the two controls that move between them.
 *
 * Three rules the design settles, encoded here rather than in each screen:
 *   1. Day always opens on today. The switcher's Day entry carries today's
 *      date as its own label, so picking it is visibly a jump to now.
 *   2. You move forward, not back. `back` is inert whenever the period on
 *      screen already contains today - in week, month and year too.
 *   3. Today comes back from anywhere. It sits between the arrows in every
 *      view, and is a no-op when you are already there.
 *
 * The grids below draw a scaffold and take their contents as props. Nothing
 * here fetches, places or moves a slot: the week is read and navigated, and a
 * block is still moved in the day.
 */

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/* ── The two controls ──────────────────────────────────────────────────── */

/**
 * The scope switcher, as its own bordered group in the sidebar.
 *
 * Bordered because these four are one control over the calendar rather than
 * four destinations sitting alongside Activities and Calendars - which is
 * exactly how they read when they were listed flat with them.
 */
export const ScopeSwitcher: React.FC<{
  /** `null` when the page is not a scope of the calendar at all - Activities,
   *  Calendars, Settings. Nothing in the group is current then, because
   *  nothing in it is where you are. */
  active: Scope | null;
  /** Today's date, on the Day entry - see rule 1. */
  dayLabel?: string;
  /** The period on screen, on whichever entry is active. */
  periodLabel?: string;
  onSelect?: (scope: Scope) => void;
}> = ({ active, dayLabel, periodLabel, onSelect }) => (
  <div className="wr-scope">
    <div className="wr-scope-label">Calendar view</div>
    <div className="wr-scope-items">
      {SCOPES.map((scope) => {
        // The active scope names what is on screen. Day also names itself when
        // it is not active, because it is the one entry that is a promise
        // about where it goes rather than a label for where you are.
        const trailing =
          scope.key === active
            ? periodLabel
            : scope.key === "day"
              ? dayLabel
              : undefined;
        return (
          <button
            key={scope.key}
            type="button"
            aria-current={scope.key === active ? "page" : undefined}
            className={cx(
              "wr-scope-item",
              scope.key === active && "wr-scope-item-active",
            )}
            onClick={() => onSelect?.(scope.key)}
          >
            {scope.label}
            {trailing ? (
              <span className="wr-scope-when">{trailing}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  </div>
);

const ChevronLeft: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const ChevronRight: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/**
 * Back, Today, forward - the same object in every view.
 *
 * `atToday` drives both ends of it: the back arrow is disabled and Today
 * stops being the one lit thing here, because there is nowhere to go home
 * from. Disabled rather than hidden, so the control does not change shape
 * under the cursor as you page around.
 */
export const ScopeNav: React.FC<{
  atToday: boolean;
  /** What "back" means here, for the screen reader: "Previous week". */
  unit: string;
  onBack?: () => void;
  onToday?: () => void;
  onForward?: () => void;
}> = ({ atToday, unit, onBack, onToday, onForward }) => (
  // The same shell the day bar's tools use, so the two groups in the header
  // are one size and one object - see `.wr-pillgroup`. The arrows are
  // `IconButton`s for the same reason: they were bespoke 26px circles next to
  // the bar's 30px ones, which is exactly the kind of drift a shared component
  // exists to prevent.
  <div className="wr-pillgroup wr-scopenav">
    <IconButton
      label={`Previous ${unit}`}
      {...(atToday ? { title: `Earlier ${unit}s aren't shown` } : {})}
      disabled={atToday}
      onClick={onBack}
    >
      <ChevronLeft />
    </IconButton>
    <button
      type="button"
      className={cx("wr-scopenav-today", !atToday && "wr-scopenav-today-live")}
      disabled={atToday}
      onClick={onToday}
    >
      Today
    </button>
    <IconButton label={`Next ${unit}`} onClick={onForward}>
      <ChevronRight />
    </IconButton>
  </div>
);

/* ── Week ──────────────────────────────────────────────────────────────── */

/** How tall an hour is drawn in the week. One number, so the gutter and the
 *  columns cannot disagree about where 13:00 is. */
const WEEK_HOUR = 52;

/**
 * Week - where the gaps are.
 *
 * Meetings sit back on the recessed surface, your own slots come forward onto
 * a lifted one, and free room is drawn dashed. The column head is the button:
 * a week is read and navigated, and a slot is still moved in the day.
 */
export const WeekGrid: React.FC<{
  days: readonly WeekDay[];
  /** The window on screen, minutes from midnight. */
  startMinutes: number;
  endMinutes: number;
  onOpenDay?: (iso: string) => void;
}> = ({ days, startMinutes, endMinutes, onOpenDay }) => {
  const hours = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
  const height = hours * WEEK_HOUR;
  const topOf = (minutes: number) =>
    ((minutes - startMinutes) / 60) * WEEK_HOUR;

  return (
    <div
      className="wr-week"
      style={{ ["--wr-week-hour" as string]: `${WEEK_HOUR}px` }}
    >
      <div className="wr-week-gutter" style={{ height }}>
        {Array.from(
          { length: hours + 1 },
          (_, index) => startMinutes + index * 60,
        ).map((minutes) => (
          <span
            key={minutes}
            className="wr-week-hour"
            style={{ top: topOf(minutes) }}
          >
            {/* A window that runs to midnight ends at 24:00, which is a real
                minute-of-day and not a time `clockOf` can write. */}
            {clockOf(Math.min(minutes, 24 * 60 - 1))}
          </span>
        ))}
      </div>

      <div className="wr-week-cols">
        {days.map((day) => (
          <div key={day.iso} className="wr-week-col">
            <button
              type="button"
              className={cx(
                "wr-week-head",
                day.today && "wr-week-head-today",
                day.past && "wr-week-head-past",
              )}
              onClick={() => onOpenDay?.(day.iso)}
            >
              <span className="wr-week-head-name">{day.label}</span>
              {day.note ? (
                <span className="wr-week-head-note">{day.note}</span>
              ) : null}
            </button>

            <div
              className={cx(
                "wr-week-track",
                day.today && "wr-week-track-today",
                day.past && "wr-week-track-past",
              )}
              style={{ height }}
            >
              {(day.blocks ?? []).map((block) => (
                <div
                  key={block.key}
                  className={cx(
                    "wr-week-block",
                    `wr-week-block-${block.variant}`,
                  )}
                  style={{
                    top: topOf(block.startMinutes),
                    height: Math.max(
                      16,
                      topOf(block.endMinutes) - topOf(block.startMinutes),
                    ),
                  }}
                >
                  {block.variant === "slot" || block.variant === "live" ? (
                    <span className="wr-week-pip" aria-hidden="true" />
                  ) : null}
                  {block.title}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** What the week's three surfaces mean, spelled out under it. */
export const WeekLegend: React.FC = () => (
  <div className="wr-legend">
    <span className="wr-legend-item">
      <i className="wr-legend-swatch wr-legend-slot" />
      Your slot
    </span>
    <span className="wr-legend-item">
      <i className="wr-legend-swatch wr-legend-meeting" />
      From a calendar
    </span>
    <span className="wr-legend-item">
      <i className="wr-legend-swatch wr-legend-free" />
      Free stretch
    </span>
    <span className="wr-legend-note">
      Click a column head to open that day. The week reads and navigates; slots
      are moved in the day.
    </span>
  </div>
);

/* ── Month ─────────────────────────────────────────────────────────────── */

const WEEK_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Keys for a run of identical marks. They have no identity of their own, so
 *  they borrow the day's and their place in it. */
const dotKeys = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/**
 * Month - one dot per slot, so a whole month reads at a glance.
 *
 * Filled dot = a minimum met, hollow = one still planned. Days before today
 * are read-only: there is nothing left to decide about them, and offering a
 * press that does nothing is worse than offering none.
 */
export const MonthGrid: React.FC<{
  cells: readonly MonthCell[];
  onOpenDay?: (iso: string) => void;
}> = ({ cells, onOpenDay }) => (
  <div className="wr-month">
    <div className="wr-month-heads">
      {WEEK_HEADS.map((name) => (
        <div key={name} className="wr-label wr-month-head">
          {name}
        </div>
      ))}
    </div>

    <div className="wr-month-grid">
      {cells.map((cell) => {
        const openable = cell.inMonth && !cell.past;
        const Tag = openable ? "button" : "div";
        return (
          <Tag
            key={cell.iso}
            {...(openable
              ? {
                  type: "button" as const,
                  onClick: () => onOpenDay?.(cell.iso),
                }
              : {})}
            className={cx(
              "wr-month-cell",
              !cell.inMonth && "wr-month-cell-out",
              cell.past && cell.inMonth && "wr-month-cell-past",
              cell.today && "wr-month-cell-today",
            )}
          >
            <span className="wr-month-cell-top">
              <span className="wr-month-day">{cell.day}</span>
              {cell.today ? (
                <span className="wr-month-today">Today</span>
              ) : cell.note ? (
                <span className="wr-month-note">{cell.note}</span>
              ) : null}
            </span>

            {(cell.taken ?? 0) + (cell.planned ?? 0) > 0 ? (
              <span className="wr-month-dots">
                {dotKeys(cell.taken ?? 0, `${cell.iso}-taken`).map((key) => (
                  <i key={key} className="wr-month-dot wr-month-dot-taken" />
                ))}
                {dotKeys(cell.planned ?? 0, `${cell.iso}-planned`).map(
                  (key) => (
                    <i key={key} className="wr-month-dot" />
                  ),
                )}
              </span>
            ) : null}
          </Tag>
        );
      })}
    </div>

    <div className="wr-legend">
      <span className="wr-legend-item">
        <i className="wr-month-dot wr-month-dot-taken" />
        Taken
      </span>
      <span className="wr-legend-item">
        <i className="wr-month-dot" />
        Planned
      </span>
      <span className="wr-legend-note">
        Days before today are read-only. Click any day from today on to open it.
      </span>
    </div>
  </div>
);

/* ── Year ──────────────────────────────────────────────────────────────── */

/** How many week bars a month card draws when it has no weeks of its own. */
const YEAR_WEEKS = 5;

/**
 * Year - twelve months of rhythm, and a way to jump.
 *
 * One bar per week, filled by the share of daily minimums met. It reads
 * history and jumps to a month; it never places a slot, which is why nothing
 * on this screen is draggable and every card is simply a link.
 */
export const YearGrid: React.FC<{
  months: readonly YearMonth[];
  onOpenMonth?: (month: number) => void;
}> = ({ months, onOpenMonth }) => (
  <div className="wr-year">
    <div className="wr-year-grid">
      {months.map((entry) => {
        const weeks =
          entry.weeks ?? (Array(YEAR_WEEKS).fill(null) as (number | null)[]);
        return (
          <button
            key={entry.month}
            type="button"
            className={cx("wr-year-card", `wr-year-card-${entry.state}`)}
            onClick={() => onOpenMonth?.(entry.month)}
          >
            <span className="wr-year-top">
              <span className="wr-year-name">{entry.label}</span>
              {entry.state === "current" ? (
                <span className="wr-year-now">This month</span>
              ) : entry.percent !== undefined ? (
                <span className="wr-year-pct">
                  {Math.round(entry.percent * 100)}%
                </span>
              ) : null}
            </span>

            <span className="wr-year-bars">
              {weeks
                .map((share, index) => ({
                  key: `${entry.month}-w${index}`,
                  share,
                  now: index === entry.nowWeek,
                }))
                .map((bar) => (
                  <span key={bar.key} className="wr-year-bar">
                    {bar.share !== null ? (
                      <i
                        className={cx(
                          "wr-year-fill",
                          entry.state === "future" && "wr-year-fill-planned",
                          bar.now && "wr-year-fill-now",
                        )}
                        style={{ width: `${Math.round(bar.share * 100)}%` }}
                      />
                    ) : null}
                    {bar.now ? <em className="wr-year-nowmark">Now</em> : null}
                  </span>
                ))}
            </span>

            {entry.note ? (
              <span className="wr-year-note">{entry.note}</span>
            ) : null}
          </button>
        );
      })}
    </div>

    <div className="wr-legend">
      <span className="wr-legend-item">
        <i className="wr-legend-swatch wr-legend-met" />
        Met
      </span>
      <span className="wr-legend-item">
        <i className="wr-legend-swatch wr-legend-planned" />
        Planned
      </span>
      <span className="wr-legend-item">
        <i className="wr-legend-swatch wr-legend-none" />
        Nothing yet
      </span>
      <span className="wr-legend-note">
        One bar per week. Click a month to open it - the year reads history and
        jumps; it never places a slot.
      </span>
    </div>
  </div>
);
