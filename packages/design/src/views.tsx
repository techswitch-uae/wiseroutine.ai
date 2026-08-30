import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  type MonthCell,
  SCOPES,
  type Scope,
  type WeekAllDay,
  type WeekBlock,
  type WeekDay,
} from "./calendar";
import { IconButton } from "./components";
import { layoutDay } from "./daygrid";
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
/**
 * The all-day band above one column.
 *
 * Rendered for every day once any day has an entry, empty ones included: the
 * band is what keeps the seven hour grids aligned, so it cannot be skipped for
 * the quiet days.
 */
const AllDayStrip: React.FC<{
  entries: readonly WeekAllDay[];
  rows: number;
  height: number;
}> = ({ entries, rows, height }) => {
  // Past the cap, the last row is spent on the count rather than on one more
  // name - so it is the overflow *including* the entry it displaces.
  const over = entries.length - rows;
  const shown = over > 0 ? entries.slice(0, rows - 1) : entries;

  return (
    <div className="wr-week-allday" style={{ height }}>
      {shown.map((entry) => (
        <span key={entry.key} className="wr-week-allday-chip">
          {entry.title}
        </span>
      ))}
      {over > 0 ? (
        <span className="wr-week-allday-more">+{over + 1} more</span>
      ) : null}
    </div>
  );
};

/** One all-day chip, and the gap under it. */
const ALLDAY_ROW = 18;
const ALLDAY_GAP = 3;

/**
 * How many all-day rows the strip draws before it starts counting.
 *
 * Three, because the strip pushes the hour grid down by its full height and a
 * conference week with eight all-day entries would leave nothing of the day
 * visible. Past the cap the last row becomes "+5 more" - a number is a worse
 * answer than a name, and a better one than a grid off the bottom of the
 * screen.
 */
const ALLDAY_MAX = 3;

/** The strip's height, or 0 when no day in the week has an all-day entry -
 *  a week of ordinary meetings should not carry an empty band. */
const stripHeightOf = (rows: number): number =>
  rows === 0 ? 0 : rows * ALLDAY_ROW + (rows - 1) * ALLDAY_GAP + 6;

/** The shortest a week block is drawn. Below this a fifteen-minute slot is a
 *  line rather than a thing with a name in it. */
const WEEK_MIN_BLOCK = 16;

/**
 * Where a day's blocks go, by the day view's own arithmetic.
 *
 * `layoutDay` rather than a second overlap algorithm here. It is the part of
 * the day that decides two things at once cannot be drawn on top of each
 * other, it is already tested, and a week that clustered differently from the
 * day would show the same two slots as a clash on one screen and as one block
 * hiding another on the next.
 *
 * It works in instants, and a week block is minutes from midnight - so
 * midnight is the epoch. `minutes * 60_000` is not a trick: it is the same
 * quantity in the units `layoutDay` reads.
 */
const layoutColumn = (blocks: readonly WeekBlock[], startMinutes: number) =>
  layoutDay(
    blocks.map((block) => ({
      key: block.key,
      block,
      startsAt: block.startMinutes * 60_000,
      endsAt: block.endMinutes * 60_000,
    })),
    {
      dayStart: startMinutes * 60_000,
      pxPerMinute: WEEK_HOUR / 60,
      minHeight: WEEK_MIN_BLOCK,
    },
  );

/**
 * Which side of the column the popover opens on.
 *
 * It is wider than the column it belongs to, and the page scroller clips
 * sideways - so the last days open leftwards rather than off the edge of the
 * week.
 */
const POP_FLIPS_AT = 4;

/** Past this far down the track, the popover opens upwards instead. */
const POP_OPENS_UP_BELOW = 0.55;

/**
 * One slot's details, opened by pressing it.
 *
 * The whole reason this exists: two overlapping slots take half a column each,
 * both titles truncate, and the layout that made the clash visible is the same
 * layout that made it unreadable. So the block shows *that* there is a clash
 * and this shows what is in it.
 *
 * Anchored by arithmetic rather than by measuring: the track's height and the
 * block's place in it are both already known here, and reading back a
 * rectangle would tie the popover to a layout pass.
 */
const BlockDetail: React.FC<{
  block: WeekBlock;
  top: number;
  blockHeight: number;
  trackHeight: number;
  flip: boolean;
}> = ({ block, top, blockHeight, trackHeight, flip }) => {
  // Below the block, until that would put it off the bottom of the track -
  // then above it. Measured against the track rather than the viewport: the
  // week does not know where it is on screen, and does not need to in order to
  // stay inside itself.
  const up = top > trackHeight * POP_OPENS_UP_BELOW;
  return (
    <div
      className={cx("wr-week-pop", flip && "wr-week-pop-flip")}
      role="dialog"
      aria-label={block.title}
      style={
        up
          ? { bottom: Math.max(0, trackHeight - top) + 6 }
          : { top: top + blockHeight + 6 }
      }
    >
      <div className="wr-week-pop-title">{block.title}</div>
      <div className="wr-week-pop-when">{block.detail?.when}</div>
      {block.detail?.note ? (
        <div className="wr-week-pop-note">{block.detail.note}</div>
      ) : null}
    </div>
  );
};

/**
 * One day's hour grid, its blocks, and the details of whichever is open.
 *
 * Its own component so the layout is computed once and read twice: the blocks
 * are drawn from it, and so is the popover's anchor. Passing the open block's
 * top down from the week meant recomputing it there, and recomputing it from
 * the start time alone got it wrong - a block is at least `WEEK_MIN_BLOCK`
 * tall whatever its duration says, and the popover opened over the block it
 * belonged to.
 */
const WeekTrack: React.FC<{
  day: WeekDay;
  startMinutes: number;
  height: number;
  open: string | null;
  onToggle: (key: string) => void;
  flip: boolean;
}> = ({ day, startMinutes, height, open, onToggle, flip }) => {
  const placed = layoutColumn(day.blocks ?? [], startMinutes);
  const shown = placed.find(
    (it) => it.block.block.key === open && it.block.block.detail,
  );

  return (
    <div
      className={cx(
        "wr-week-track",
        day.today && "wr-week-track-today",
        day.past && "wr-week-track-past",
      )}
      style={{ height }}
    >
      {placed.map((it) => {
        const block = it.block.block;
        // A detail is what makes a block pressable - see `WeekBlock`.
        const Tag = block.detail ? "button" : "div";
        const isOpen = open === block.key;
        return (
          <Tag
            key={block.key}
            {...(block.detail
              ? {
                  type: "button" as const,
                  "aria-haspopup": "dialog" as const,
                  "aria-expanded": isOpen,
                  onClick: () => onToggle(block.key),
                }
              : {})}
            className={cx(
              "wr-week-block",
              `wr-week-block-${block.variant}`,
              block.detail && "wr-week-block-open",
              isOpen && "wr-week-block-shown",
            )}
            style={{
              top: it.top,
              height: it.height,
              // Halves of a column, the day's own way of drawing a clash. Two
              // names side by side both truncate, which is exactly what the
              // popover is for. The 3px comes off the width rather than out of
              // a margin, so the share stays a share and the gap lands between
              // the two rather than past them.
              left: `${(it.column / it.columns) * 100}%`,
              width: `calc(${(it.span / it.columns) * 100}% - 3px)`,
            }}
          >
            {block.variant === "slot" || block.variant === "live" ? (
              <span className="wr-week-pip" aria-hidden="true" />
            ) : null}
            <span className="wr-week-block-name">{block.title}</span>
          </Tag>
        );
      })}

      {/* A sibling of the blocks, not a child of one: a block clips its own
          contents, and one 140px wide would clip this to nothing. */}
      {shown ? (
        <BlockDetail
          block={shown.block.block}
          top={shown.top}
          blockHeight={shown.height}
          trackHeight={height}
          flip={flip}
        />
      ) : null}
    </div>
  );
};

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

  // One height for all seven columns, so the hour lines stay level across the
  // week - a per-column strip would stagger Tuesday's 09:00 against Monday's.
  const allDayRows = Math.min(
    ALLDAY_MAX,
    days.reduce((most, day) => Math.max(most, day.allDay?.length ?? 0), 0),
  );
  const stripHeight = stripHeightOf(allDayRows);

  /** The one block whose details are open, by key. One at a time: two
   *  popovers over a grid this dense would overlap each other. */
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Same rule as every other popover in the app - one that survives a click
  // elsewhere is one people fight with. See `HoursMenu`.
  useEffect(() => {
    if (open === null) return;

    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className="wr-week"
      ref={root}
      style={{
        ["--wr-week-hour" as string]: `${WEEK_HOUR}px`,
        // The gutter is positioned from the top of the column, so it has to be
        // told how far down the hour grid now starts.
        ["--wr-week-allday" as string]: `${stripHeight}px`,
      }}
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
        {days.map((day, index) => (
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

            {allDayRows > 0 ? (
              <AllDayStrip
                entries={day.allDay ?? []}
                rows={allDayRows}
                height={stripHeight}
              />
            ) : null}

            <WeekTrack
              day={day}
              startMinutes={startMinutes}
              height={height}
              open={open}
              onToggle={(key) => setOpen((was) => (was === key ? null : key))}
              flip={index >= POP_FLIPS_AT}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Month ─────────────────────────────────────────────────────────────── */

const WEEK_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Keys for a run of identical marks. They have no identity of their own, so
 *  they borrow the day's and their place in it. */
const dotKeys = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/**
 * Month - one dot per slot, so a whole month reads at a glance.
 *
 * Filled dot = a slot done, hollow = one still planned. Days before today are
 * read-only: there is nothing left to decide about them, and offering a press
 * that does nothing is worse than offering none.
 */
export const MonthGrid: React.FC<{
  cells: readonly MonthCell[];
  onOpenDay?: (iso: string) => void;
  /**
   * The first day meetings are known for, written out - "30 August 2026".
   *
   * Said here because this is the screen that shows the past, and the past is
   * where the answer changes: nothing is fetched from before a calendar was
   * connected, so an empty February is the sync window, not a quiet month.
   * Absent when no calendar is connected, which is the one case where the
   * sentence would raise a question rather than answer one.
   */
  meetingsFrom?: string;
}> = ({ cells, onOpenDay, meetingsFrom }) => (
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

            {(cell.done ?? 0) + (cell.planned ?? 0) > 0 ? (
              <span className="wr-month-dots">
                {dotKeys(cell.done ?? 0, `${cell.iso}-done`).map((key) => (
                  <i key={key} className="wr-month-dot wr-month-dot-done" />
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
        <i className="wr-month-dot wr-month-dot-done" />
        Done
      </span>
      <span className="wr-legend-item">
        <i className="wr-month-dot" />
        Planned
      </span>
      <span className="wr-legend-note">
        Days before today are read-only. Click any day from today on to open it.
        {meetingsFrom
          ? ` Meetings are synced from ${meetingsFrom} onwards.`
          : ""}
      </span>
    </div>
  </div>
);
