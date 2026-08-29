import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type DayDensity,
  type DayScale,
  dropAt,
  edgeScroll,
  layoutDay,
  type PlacedBlock,
  SNAP_MINUTES,
  yOf,
} from "./daygrid";
import {
  clockOf,
  DAY_NAMES,
  daysLabel,
  minutesOf,
  runsOnDay,
  toggleDay,
  WEEK_ORDER,
} from "./time";

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/** The one glyph the kit uses inline. Everything else is Lucide at
 *  stroke-width 2.75 - add `lucide-react` when the first screen needs it. */
export const PlayGlyph: React.FC = () => (
  <svg
    width="10"
    height="12"
    viewBox="0 0 10 12"
    fill="currentColor"
    role="img"
  >
    <title>Start</title>
    <polygon points="0,0 10,6 0,12" />
  </svg>
);

/** The second inline glyph. Still no icon dependency: two shapes do not earn
 *  one, and a dependency for an arrow is a dependency to keep updated. */
export const RefreshGlyph: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" role="img">
    <title>Sync</title>
    <path
      d="M14 8a6 6 0 1 1-1.76-4.24M14 2v4h-4"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The third and last inline glyph: the day-view hours control. Two ruled
 *  lines with a handle on each, which is the range being moved. */
export const HoursGlyph: React.FC = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.75"
    strokeLinecap="round"
    role="img"
  >
    <title>Hours shown</title>
    <path d="M4 8h10" />
    <path d="M18 8h2" />
    <path d="M4 16h4" />
    <path d="M12 16h8" />
    <circle cx="16" cy="8" r="2.2" />
    <circle cx="10" cy="16" r="2.2" />
  </svg>
);

/**
 * One end of a window.
 *
 * `input type="time"` rather than a stepper or a custom picker: the platform
 * already has the keyboard handling, the locale-correct display and the
 * 12/24-hour preference, and none of that is worth reimplementing to get a
 * pill with rounded corners.
 *
 * ponytail: the native control tops out at 23:59, so a day cannot be set to
 * end at midnight itself. Nobody has asked to; a plain text field with parsing
 * is the upgrade if they do.
 */
export const TimeField: React.FC<{
  label: string;
  minutes: number;
  onChange?: (minutes: number) => void;
  disabled?: boolean;
}> = ({ label, minutes, onChange, disabled }) => (
  <input
    type="time"
    className="wr-timefield"
    aria-label={label}
    value={clockOf(minutes)}
    disabled={disabled}
    onChange={(event) => {
      const next = minutesOf(event.target.value);
      // Mid-edit the field reads as empty; keeping the last good value beats
      // storing a zero the user never typed.
      if (next !== null) onChange?.(next);
    }}
  />
);

/* ── Actions ─────────────────────────────────────────────────────────────── */

export type ButtonVariant = "primary" | "commit" | "secondary" | "quiet";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = start/schedule · commit = confirm/save · secondary = sand
   *  alternative · quiet = the escape route. Chosen by consequence. */
  variant?: ButtonVariant;
  block?: boolean;
};

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  block,
  className,
  ...rest
}) => (
  <button
    type="button"
    className={cx(
      "wr-btn",
      `wr-btn-${variant}`,
      block && "wr-btn-block",
      className,
    )}
    {...rest}
  />
);

export const PROVIDER_NAMES = {
  google: "Google",
  microsoft: "Microsoft",
} as const;

/**
 * "Continue with Google".
 *
 * A neutral badge, not the provider's logo: the kit already refuses brand
 * colour for provenance (`SourceMark`), and a logo is someone else's asset
 * with someone else's rules about how it may be drawn.
 */
export const ProviderButton: React.FC<
  Omit<ButtonProps, "variant"> & {
    provider: "google" | "microsoft";
    /** Overrides "Continue with X" - used for the waiting state, where the
     *  button has to say what it is now doing rather than what it offers. */
    label?: string;
  }
> = ({ provider, label, className, ...rest }) => (
  <button
    type="button"
    className={cx("wr-btn", "wr-btn-provider", className)}
    {...rest}
  >
    <span
      className={cx(
        "wr-provider-mark",
        provider === "microsoft" && "wr-provider-microsoft",
      )}
      aria-hidden="true"
    >
      {provider === "google" ? "G" : "M"}
    </span>
    {label ?? `Continue with ${PROVIDER_NAMES[provider]}`}
  </button>
);

/** "or" - between two routes to the same place. */
export const Rule: React.FC<{ children?: React.ReactNode }> = ({
  children = "or",
}) => <div className="wr-divider">{children}</div>;

export type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /**
   * Omit when a `Card` title is already naming this field - repeating it
   * inside the card says the same word twice.
   *
   * A field with no visible label still needs a name for anyone not looking
   * at it, so pass `aria-label` in that case. There is no sensible default:
   * only the caller knows what the surrounding title says.
   */
  label?: string;
};

/** A labelled pill. The label is real, not a placeholder: a placeholder
 *  disappears exactly when the user needs it to check what they typed. */
export const Field: React.FC<FieldProps> = ({
  label,
  id,
  className,
  ...rest
}) => {
  const inputId =
    id ?? `wr-field-${(label ?? "input").toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={cx("wr-field", className)}>
      {label ? (
        <label className="wr-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input id={inputId} className="wr-field-input" {...rest} />
    </div>
  );
};

export type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** Optional for the same reason as `Field`'s - see there. */
  label?: string;
  options: readonly string[];
};

/**
 * A labelled pill that happens to be a `<select>`.
 *
 * A native select rather than a custom listbox: four hundred time zones want
 * type-ahead, keyboard paging and a scroll position the OS already knows how
 * to give, and every one of those is something a div would have to
 * re-implement badly.
 */
export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  options,
  id,
  className,
  ...rest
}) => {
  const inputId =
    id ?? `wr-select-${(label ?? "select").toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={cx("wr-field", className)}>
      {label ? (
        <label className="wr-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <select id={inputId} className="wr-field-input wr-select" {...rest}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};

export type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Digits stay on screen so they can be checked against the email. */
  wrong?: boolean;
  length?: number;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Fired when the last digit lands - including on paste, which is the
   *  point: the user copies six characters and never presses anything. */
  onComplete?: (value: string) => void;
};

export const CodeInput: React.FC<CodeInputProps> = ({
  value,
  onChange,
  wrong,
  length = 6,
  label = "Sign-in code",
  autoFocus,
  disabled,
  onComplete,
}) => {
  const digits = value.slice(0, length).split("");

  return (
    <div className={cx("wr-code", wrong && "wr-code-wrong")}>
      <div className="wr-code-boxes" aria-hidden="true">
        {Array.from({ length }, (_, index) => {
          const digit = digits[index];
          // The caret sits on the first empty box, and nowhere once the code
          // is full - a caret past the last digit reads as "keep typing".
          const active = !wrong && index === digits.length && !disabled;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length row of positional boxes - the index is the identity, and there is no list to reorder.
              key={index}
              className={cx(
                "wr-code-box",
                digit !== undefined && "wr-code-box-filled",
                active && "wr-code-box-active",
              )}
            >
              {digit ?? (active ? <span className="wr-code-caret" /> : null)}
            </div>
          );
        })}
      </div>
      <input
        className="wr-code-input"
        value={value}
        onChange={(event) => {
          // Strip everything that is not a digit rather than rejecting the
          // input: a pasted "418 206" is the right code, typed by someone who
          // copied it out of the email with its spacing.
          const next = event.target.value.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        aria-label={label}
        // biome-ignore lint/a11y/noAutofocus: the code screen exists only to take this one value, and the user was just sent here to type it.
        autoFocus={autoFocus}
        disabled={disabled}
      />
    </div>
  );
};

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  /** Spins the glyph while the work is in flight. */
  busy?: boolean;
};

/**
 * A round button carrying one glyph.
 *
 * For an action that is a verb the user already understands - refresh, close -
 * and would only be made longer by a word. Anything that needs explaining is a
 * `Button` with text on it instead.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  busy,
  className,
  children,
  ...rest
}) => (
  <button
    type="button"
    className={cx("wr-iconbtn", busy && "wr-iconbtn-busy", className)}
    aria-label={label}
    title={label}
    {...rest}
  >
    {children}
  </button>
);

/* ── Which hours the day shows ───────────────────────────────────────────── */

export interface HoursRange {
  /** "working" | "full" | "custom" - stable, unlike the label. */
  key: string;
  /** What the row reads. The custom range is named by the user. */
  label: string;
  startMinutes: number;
  endMinutes: number;
}

/**
 * The hours picker: a round trigger and the ranges under it.
 *
 * It sits with the date rather than in the toolbar because it changes what the
 * timeline below covers - it belongs to the thing it acts on. The toolbar on
 * the other side is for going and fetching, which is a different class of act.
 *
 * Nothing configurable lives in here. Three rows and a way out to the settings
 * that own them: a popover that could also edit the hours would be a settings
 * page in a 300px box, reachable from one screen.
 */
export const HoursMenu: React.FC<{
  ranges: readonly HoursRange[];
  /** The key of the range on screen. */
  value: string;
  onChange?: (key: string) => void;
  /** Takes the user to where the ranges are configured. */
  onEdit?: () => void;
  /** The densities on offer, and the one in force. Omitted, the section is
   *  not drawn at all - the gallery shows the menu without it. */
  densities?: readonly DayDensity[];
  density?: string;
  onDensityChange?: (key: string) => void;
}> = ({
  ranges,
  value,
  onChange,
  onEdit,
  densities,
  density,
  onDensityChange,
}) => {
  const [open, setOpen] = useState(false);
  const densityId = useId();
  const root = useRef<HTMLDivElement>(null);
  const rangesId = useId();

  // Same rule as the user menu: a popover that survives a click elsewhere is a
  // popover people fight with.
  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="wr-hours" ref={root}>
      <IconButton
        label="Hours shown"
        className={cx(open && "wr-iconbtn-on")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <HoursGlyph />
      </IconButton>

      {open ? (
        <div className="wr-hours-pop" role="menu">
          <div className="wr-label wr-hours-title" id={rangesId}>
            Hours shown
          </div>
          {/* Two groups, each named. Without this a screen reader hears one
              undifferentiated run of radios and has no way to know that the
              first five are two separate questions - and neither does a test. */}
          <div
            className="wr-hours-list"
            role="group"
            aria-labelledby={rangesId}
          >
            {ranges.map((range) => (
              <button
                key={range.key}
                type="button"
                role="menuitemradio"
                aria-checked={range.key === value}
                className="wr-hours-opt"
                onClick={() => {
                  setOpen(false);
                  onChange?.(range.key);
                }}
              >
                <span className="wr-hours-dot" aria-hidden="true" />
                <span className="wr-hours-name">{range.label}</span>
                <span className="wr-hours-span">
                  {clockOf(range.startMinutes)}–
                  {range.endMinutes >= 24 * 60
                    ? "24:00"
                    : clockOf(range.endMinutes)}
                </span>
              </button>
            ))}
          </div>
          <div className="wr-hours-foot">
            <button
              type="button"
              className="wr-hours-edit"
              onClick={() => {
                setOpen(false);
                onEdit?.();
              }}
            >
              Edit hours and ranges
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          {densities && densities.length > 0 ? (
            // A segmented control, not a second list of rows. Three names is
            // the whole choice, and drawn as rows they read as a continuation
            // of the ranges above rather than a different question. The group
            // still carries a name for anyone not looking at it.
            <div className="wr-hours-density">
              <div className="wr-label wr-hours-title" id={densityId}>
                Row height
              </div>
              <Segmented
                labelledBy={densityId}
                options={densities.map((option) => ({
                  value: option.key,
                  label: option.label,
                }))}
                value={density ?? ""}
                {...(onDensityChange ? { onChange: onDensityChange } : {})}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * The meetings the chosen range does not cover, as one line.
 *
 * Hiding them outright is the failure this exists to prevent: someone looking
 * at their evenings has no way to know a 09:00 exists, and a day view that
 * silently omits meetings is worse than one that shows too many. So the day
 * keeps its edges, and the edges say what is beyond them.
 */
export const OutsideRange: React.FC<{
  edge: "before" | "after";
  count: number;
  /** The boundary the meetings fall outside of, already formatted. */
  at: string;
  /** Widens the view to the whole day. */
  onExpand?: () => void;
}> = ({ edge, count, at, onExpand }) => (
  <div className={cx("wr-outside", `wr-outside-${edge}`)}>
    <span className="wr-outside-text">
      {count} {count === 1 ? "meeting" : "meetings"}{" "}
      {edge === "before" ? "before" : "after"} {at}
    </span>
    {onExpand ? (
      <button type="button" className="wr-outside-more" onClick={onExpand}>
        Show the full day
      </button>
    ) : null}
  </div>
);

export type ChipVariant =
  | "inset"
  | "selected"
  | "ink"
  | "static"
  | "dashed"
  | "key";

export type ChipProps = React.HTMLAttributes<HTMLElement> & {
  variant?: ChipVariant;
  /** A chip the user can tap renders as a <button>; a state marker does not. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

export const Chip: React.FC<ChipProps> = ({
  variant = "inset",
  className,
  onClick,
  ...rest
}) => {
  const cls = cx(
    "wr-chip",
    variant !== "inset" && `wr-chip-${variant}`,
    className,
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} {...rest} />
  ) : (
    <span className={cls} {...rest} />
  );
};

export type ToggleProps = {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label: string;
};

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className="wr-toggle"
    onClick={() => onChange?.(!checked)}
  />
);

export type SegmentedProps<T extends string> = {
  /** A bare string is its own label. Pass the object form when what the user
   *  reads and what the value is are not the same word. */
  options: readonly (T | { value: T; label: string })[];
  value: T;
  onChange?: (next: T) => void;
  label?: string;
  /**
   * The id of a heading that already names this group, instead of `label`.
   *
   * Where the name is on screen anyway, pointing at it beats repeating it:
   * `aria-label` would have the heading read out and then the same words again
   * as the group's name.
   */
  labelledBy?: string;
};

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
}: SegmentedProps<T>): React.ReactElement => (
  <div
    className="wr-seg"
    role="group"
    {...(labelledBy
      ? { "aria-labelledby": labelledBy }
      : { "aria-label": label })}
  >
    {options.map((option) => {
      const opt =
        typeof option === "string" ? { value: option, label: option } : option;
      return (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          className="wr-seg-opt"
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

/* ── Slot cards ──────────────────────────────────────────────────────────── */

export type SlotVariant =
  | "focus"
  | "recovery"
  | "live"
  | "meeting"
  /** Proposed by the scheduler, not yet accepted - Pro only. Accent-100 with a
   *  ring and no shadow: it is not a real thing on the page, so it must not
   *  lift. Free shows a `DashedRow` in the same position instead. */
  | "suggested";

export type SlotProps = {
  variant: SlotVariant;
  time: string;
  name: string;
  meta?: string;
  /** focus/recovery: the trailing element. Done state is a chip - never dim. */
  done?: boolean;
  /** meeting: the provider mark, e.g. "G" or "O". */
  source?: string;
  /** live: the auto-move sentence and the draining grace bar (0–1). */
  autoMove?: string;
  grace?: number;
  onStart?: () => void;
  /** suggested: the trailing label. Defaults to "Suggested". */
  badge?: string;
};

export const Slot: React.FC<SlotProps> = ({
  variant,
  time,
  name,
  meta,
  done,
  source,
  autoMove,
  grace = 1,
  onStart,
  badge = "Suggested",
}) => {
  const isLive = variant === "live";
  return (
    <div className="wr-slot-row">
      <div className={cx("wr-time", isLive && "wr-time-now")}>{time}</div>
      <div className={cx("wr-slot", `wr-slot-${variant}`)}>
        {isLive ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="wr-rule" />
              <div>
                <div className="wr-slot-name">{name}</div>
                {meta ? <div className="wr-slot-meta">{meta}</div> : null}
              </div>
              <div className="wr-slot-trailing">
                {autoMove ? (
                  <div className="wr-slot-automove">{autoMove}</div>
                ) : null}
                <Button variant="primary" onClick={onStart}>
                  <PlayGlyph />
                  Start
                </Button>
              </div>
            </div>
            <div className="wr-bar" style={{ marginTop: 12 }}>
              <div
                className="wr-bar-fill"
                style={{ width: `${grace * 100}%` }}
              />
            </div>
          </>
        ) : variant === "meeting" ? (
          <>
            <span className="wr-slot-name">{name}</span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                font: "400 11.5px var(--font-body)",
                color: "var(--wr-text-muted)",
              }}
            >
              {source ? (
                <span className="wr-source wr-source-sm">{source}</span>
              ) : null}
              {meta}
            </span>
          </>
        ) : (
          <>
            <span className="wr-rule" />
            <span className="wr-slot-name">{name}</span>
            {meta ? <span className="wr-slot-meta">{meta}</span> : null}
            {variant === "suggested" ? (
              <span className="wr-slot-trailing">
                <span className="wr-badge">{badge}</span>
              </span>
            ) : done ? (
              <span className="wr-slot-trailing">
                <Chip>Done</Chip>
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

/** Protected gap, add row, undated reminder - the one "nothing here yet" look. */
export interface DayGridItem {
  key: string;
  startsAt: number;
  endsAt: number;
  node: React.ReactNode;
  /**
   * Can be dragged to another time. Our own slots are; a meeting is not,
   * because moving it here would say we can move it in the calendar it came
   * from, and we never write back.
   */
  movable?: boolean;
  /** Named in the drag handle's label. Only read when `movable`. */
  title?: string;
  /**
   * What Enter and Delete do to this block.
   *
   * On the item rather than on the grid, unlike `onMove`, and the split is
   * principled: moving is something the grid *computes* - it owns the ruler
   * and works out the new time - where starting and removing are the item's
   * own business and the grid only relays the keypress. Omit either and that
   * key does nothing here, which is right for a slot already finished.
   */
  onStart?: () => void;
  onRemove?: () => void;
}

export type DayGridProps = {
  /** Epoch ms bounding the visible day. */
  dayStart: number;
  dayEnd: number;
  /** The zone the labels are written in - the user's, never the device's. */
  timeZone: string;
  items: readonly DayGridItem[];
  /** Pins the now line to an instant, for the gallery and for tests. Left out,
   *  the line is live and keeps its own minute-aligned clock - see `NowLine`.
   *  Either way it is drawn only when it falls inside the window. */
  now?: number;
  /** Height of a quarter-hour. The scale, and the only one there is. */
  quarterStep?: number;
  /** The shortest a block may be drawn - see `DayScale.minHeight`. */
  minBlockHeight?: number;
  /** Fires once, on drop, with instants already snapped to the ruler. Without
   *  it nothing is draggable however the items are marked. */
  onMove?: (key: string, startsAt: number, endsAt: number) => void;
};

const QUARTER = 15 * 60_000;
const HOUR = 60 * 60_000;

/** How close the now label may come to an hour's before one has to give way. */
const LABEL_CLEARANCE = 13;

/**
 * The line where the day has got to.
 *
 * It keeps its own clock, for two reasons. The line is the only thing on the
 * page that changes every minute, and hoisting that into the page meant the
 * whole day re-rendered on a timer to move one border a few pixels. And the
 * timer that lived up there was a plain 60s interval started at mount, so it
 * fired at whatever second the page happened to load: the system clock ticked
 * over to a new minute and this line sat still for up to another 59 seconds.
 * Waiting for the next minute boundary and re-arming from there is what makes
 * it track the clock rather than drift alongside it.
 *
 * `at` pins it, for the gallery and for tests. Without it the line is live.
 */
const NowLine: React.FC<{
  at?: number;
  dayStart: number;
  dayEnd: number;
  scale: DayScale;
  label: Intl.DateTimeFormat;
}> = ({ at, dayStart, dayEnd, scale, label }) => {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    // Pinned: there is nothing to follow.
    if (at !== undefined) return;

    let timer: ReturnType<typeof setTimeout>;
    const atNextMinute = () => {
      timer = setTimeout(
        () => {
          setTick(Date.now());
          atNextMinute();
        },
        // Re-measured every time rather than a fixed 60s, so the line cannot
        // drift away from the minute across a long session, or after the
        // machine has been asleep.
        60_000 - (Date.now() % 60_000),
      );
    };
    atNextMinute();
    return () => clearTimeout(timer);
  }, [at]);

  const now = at ?? tick;
  if (now < dayStart || now > dayEnd) return null;

  const top = yOf(now, scale);

  /**
   * Whether this label and the nearest hour's would sit on top of each other.
   *
   * Only the hours carry a number, so this is the only collision there is. When
   * it happens the hour keeps its number and this one goes: the hour is the
   * fixed thing the day is read against, and two numbers a few pixels apart are
   * worse than one. The accent line and its dot still say exactly where now is.
   */
  const hour = Math.round(now / HOUR) * HOUR;
  const crowded =
    hour >= dayStart &&
    hour <= dayEnd &&
    Math.abs(yOf(hour, scale) - top) < LABEL_CLEARANCE;

  return (
    <div className="wr-daygrid-now" style={{ top }}>
      {crowded ? null : (
        <span className="wr-daygrid-now-label">
          {label.format(new Date(now))}
        </span>
      )}
    </div>
  );
};

/** How far the pointer travels before a press becomes a drag. Below this it is
 *  a click, and a card that jumps on every click is unusable. */
const DRAG_THRESHOLD = 4;

/**
 * The thing that scrolls when this element does not fit.
 *
 * A drag has to find this for itself. The browser auto-scrolls for its own
 * native drags and for a text selection being swept - and this is neither, on
 * purpose, so nothing scrolls unless we do it. Falls back to the page, which is
 * what scrolls when nothing closer does.
 */
const scrollerOf = (element: Element | null): Element | null => {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return document.scrollingElement;
};

/**
 * The day as a ruled surface.
 *
 * Every minute is the same height, everywhere. It did not used to be: a stretch
 * something occupied got room to be read and an empty one collapsed to a line,
 * on the argument that a uniform scale forces a bad choice either way - fine
 * enough to read a short block and the empty afternoon is a screen of nothing,
 * coarse enough to fit the day and every block is a sliver.
 *
 * That argument was right about the scroll and wrong about the cost. A ruler
 * that rescales as things move is a ruler you cannot drag on: picking a block
 * up changes what is occupied, which changes every row height, which moves the
 * target out from under the cursor. Nothing about a surface you place things on
 * by hand may depend on where the things currently are. The sliver problem is
 * solved at the other end instead, by `minBlockHeight` - a block shorter than
 * one line of text is drawn as one line of text, and everything above that is
 * its true duration.
 *
 * Blocks are positioned absolutely against that scale rather than laid into
 * grid rows. With a uniform ruler the two draw identically, and absolute
 * positioning buys the thing rows cannot: a block may be taller than its own
 * duration without pushing anything else down.
 *
 * The drag is the ordinary two-part one. The card follows the cursor exactly,
 * because a card that snaps as you move it feels like it is fighting you; a
 * shadow behind it shows where it would actually land, snapped to five minutes
 * and laid out through the same function as every other block - so the preview
 * is not an impression of the drop, it *is* the drop, drawn early.
 */
export const DayGrid: React.FC<DayGridProps> = ({
  dayStart,
  dayEnd,
  timeZone,
  items,
  now,
  quarterStep = 64,
  minBlockHeight = 46,
  onMove,
}) => {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const scale: DayScale = {
    dayStart,
    pxPerMinute: quarterStep / 15,
    minHeight: minBlockHeight,
  };

  /**
   * The drag in progress.
   *
   * `pointer` is where the cursor is, in client coordinates, and is what the
   * floating card follows. `startsAt` is where the drop would land, snapped.
   * They are deliberately two numbers rather than one derived from the other:
   * the card must not snap, and the shadow must.
   */
  const [drag, setDrag] = useState<{
    key: string;
    /** Where inside the card the pointer took hold, so it does not jump. */
    grabX: number;
    grabY: number;
    x: number;
    y: number;
    startsAt: number;
    endsAt: number;
    /** False until the pointer has moved far enough to mean it. */
    live: boolean;
  } | null>(null);

  const surface = useRef<HTMLDivElement>(null);

  const height = yOf(dayEnd, scale);

  // The shadow takes the dragged block's place in the layout, so the preview is
  // laid out - column and all - by exactly the rules the drop will follow.
  const shown =
    drag?.live === true
      ? items.map((item) =>
          item.key === drag.key
            ? { ...item, startsAt: drag.startsAt, endsAt: drag.endsAt }
            : item,
        )
      : items;
  const placed = layoutDay(shown, scale);

  const ticks: number[] = [];
  for (
    let at = Math.ceil(dayStart / QUARTER) * QUARTER;
    at < dayEnd;
    at += QUARTER
  ) {
    ticks.push(at);
  }

  /**
   * Where the top of the dragged card is, on the surface.
   *
   * Arithmetic against one rectangle read at the moment it is needed, rather
   * than a table of element positions - the surface cannot move under its own
   * drag, so this is exact for as long as the drag lasts.
   */
  const topOf = useCallback((clientY: number, grabY: number): number => {
    const box = surface.current?.getBoundingClientRect();
    return clientY - grabY - (box?.top ?? 0);
  }, []);

  const commit = (key: string, startsAt: number, endsAt: number) => {
    const from = items.find((item) => item.key === key);
    // A press that never moved is a press, and must not spend a write saying
    // nothing changed.
    if (from && from.startsAt !== startsAt) onMove?.(key, startsAt, endsAt);
  };

  const handles = (item: DayGridItem) => ({
    tabIndex: 0,
    // Read once, on focus, and the only way anyone learns these keys without a
    // mouse. Long, and it earns its length.
    "aria-label": `${item.title ?? "Slot"} at ${label.format(
      new Date(item.startsAt),
    )}. Drag or use the arrow keys to move it${
      item.onStart ? ", Enter to start it" : ""
    }${item.onRemove ? ", Delete to take it off today" : ""}.`,
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      // A press on Start is a press on Start - only the card around it is a
      // handle. Without this every attempt to start a slot lifted it instead.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button")) return;

      // Stops the browser starting a text selection under the drag. It also
      // suppresses the focus that a press would normally give, so that is done
      // by hand - the keyboard move below needs the block focusable.
      event.preventDefault();
      event.currentTarget.focus();

      const box = event.currentTarget.getBoundingClientRect();
      setDrag({
        key: item.key,
        grabX: event.clientX - box.left,
        grabY: event.clientY - box.top,
        // The press point, and it stays the press point: until the drag goes
        // live the update below returns unchanged, so the threshold is measured
        // against where the press started rather than against the last move. A
        // slow drag of two pixels a frame has to become a drag eventually.
        x: event.clientX,
        y: event.clientY,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        live: false,
      });
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Everything here belongs to the block that has focus, which is what
      // makes it safe: none of it can fire while someone is typing somewhere
      // else on the page.
      if (event.key === "Enter") {
        if (!item.onStart) return;
        event.preventDefault();
        item.onStart();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!item.onRemove) return;
        // Backspace is Back in some shells, and losing the page is a worse
        // outcome than losing the slot.
        event.preventDefault();
        item.onRemove();
        return;
      }

      if (event.key === "Escape") {
        // Only when there is nothing else for Escape to mean. Mid-drag it
        // belongs to the drag, which cancels on the window listener above -
        // blurring as well would take the block away from someone who was
        // only trying to put it back.
        if (dragging) return;
        event.currentTarget.blur();
        return;
      }

      const step =
        event.key === "ArrowUp"
          ? -SNAP_MINUTES
          : event.key === "ArrowDown"
            ? SNAP_MINUTES
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const moved = dropAt(
        yOf(item.startsAt, scale) + step * scale.pxPerMinute,
        item,
        scale,
        dayEnd,
      );
      commit(item.key, moved.startsAt, moved.endsAt);
    },
  });

  const dragging = drag !== null;

  /**
   * What the drag needs from a render that may since have been replaced.
   *
   * The listeners below are attached once, when a drag starts, and outlive
   * every render it causes - so they cannot close over props. A ref updated on
   * every render is the smallest thing that keeps them current.
   */
  const latest = useRef({ items, scale, dayEnd, onMove, drag });
  useEffect(() => {
    latest.current = { items, scale, dayEnd, onMove, drag };
  });

  /**
   * The drag itself: on the window, not on the block.
   *
   * The obvious place for these is the block being dragged, with
   * `setPointerCapture` keeping the events coming once the cursor leaves it.
   * That is what this used to do, and it broke in a way worth remembering: the
   * layout used to hand blocks back in drawn order, so crossing another block
   * changed this one's place in the list, React moved the DOM node to match,
   * and moving a node releases its pointer capture. The drag froze mid-air.
   *
   * The layout no longer reorders, which fixes that. Listening on the window
   * fixes the whole class of it: nothing about the drag depends any more on
   * the dragged element keeping its identity, its position in the tree, or its
   * capture - only on the pointer, which is the thing actually being followed.
   *
   * Escape cancels, and nothing selects text while a drag is live. The
   * selection guard is on the body rather than the block, because the problem
   * is not the block: a drag that wanders off the side of the calendar has the
   * browser sweep a selection across whatever is out there.
   */
  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      setDrag((current) => {
        if (!current) return current;

        const live =
          current.live ||
          Math.abs(event.clientY - current.y) > DRAG_THRESHOLD ||
          Math.abs(event.clientX - current.x) > DRAG_THRESHOLD;
        if (!live) return current;

        const { scale: at, dayEnd: end } = latest.current;
        return {
          ...current,
          live,
          x: event.clientX,
          y: event.clientY,
          ...dropAt(topOf(event.clientY, current.grabY), current, at, end),
        };
      });
    };

    const onPointerUp = () => {
      setDrag((current) => {
        if (current?.live === true) {
          const { items: shown, onMove: move } = latest.current;
          const from = shown.find((item) => item.key === current.key);
          // A press that never moved is a press, and must not spend a write
          // saying nothing changed.
          if (from && from.startsAt !== current.startsAt) {
            move?.(current.key, current.startsAt, current.endsAt);
          }
        }
        return null;
      });
    };

    // Losing the pointer - a system gesture, a window switch - is not a drop.
    // The block goes back where it was and nothing is written.
    const onCancel = () => setDrag(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrag(null);
    };

    /**
     * Bring the day with you when the block reaches an edge.
     *
     * On a frame loop rather than on pointer moves, because the pointer stops
     * moving the moment it reaches the edge - it has nowhere left to go - and
     * that is exactly when the scrolling has to start. The drop is recomputed
     * every frame for the same reason: the cursor is still, but the day is
     * sliding underneath it, so the time under the cursor is changing.
     */
    const scroller = scrollerOf(surface.current);
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);

      const current = latest.current.drag;
      if (!current?.live || !scroller) return;

      const box =
        scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : scroller.getBoundingClientRect();

      const by = edgeScroll(current.y, box);
      if (by === 0) return;

      const from = scroller.scrollTop;
      scroller.scrollTop = from + by;
      // Nothing moved: already at the end of the day, so there is nothing to
      // recompute and no reason to spend a render saying so.
      if (scroller.scrollTop === from) return;

      setDrag((held) => {
        if (!held) return held;
        const { scale: at, dayEnd: end } = latest.current;
        return {
          ...held,
          ...dropAt(topOf(held.y, held.grabY), held, at, end),
        };
      });
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
    document.body.classList.add("wr-dragging");

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("wr-dragging");
    };
    // Only `dragging`. Everything else the listeners need is read through a
    // ref or is stable by construction, because a dependency that changed mid
    // drag would detach them in the middle of the gesture they are running.
  }, [dragging, topOf]);

  const dragged = drag?.live === true ? drag : null;

  return (
    <div
      ref={surface}
      className="wr-daygrid"
      style={{ height, ...({ "--wr-quarter": `${quarterStep}px` } as object) }}
    >
      {ticks.map((at) => {
        const onTheHour = at % HOUR === 0;
        return (
          <div
            key={at}
            data-at={at}
            className={cx("wr-daygrid-tick", onTheHour && "wr-daygrid-hour")}
            style={{ top: yOf(at, scale) }}
          >
            {/* The hour is what is read; the quarters are what a block is
                measured against, and a number on each of them is forty numbers
                down the side of a working day. */}
            {onTheHour ? (
              <span className="wr-daygrid-label">
                {label.format(new Date(at))}
              </span>
            ) : null}
          </div>
        );
      })}

      <NowLine
        {...(now !== undefined ? { at: now } : {})}
        dayStart={dayStart}
        dayEnd={dayEnd}
        scale={scale}
        label={label}
      />

      <div className="wr-daygrid-lanes">
        {placed.map(
          ({ block, top, height: blockHeight, column, span, columns }) => {
            const movable = onMove !== undefined && block.movable === true;
            // Keys, not dragging, decide whether this is a thing you can focus:
            // a finished slot that can still be removed is still worth reaching.
            const keyed =
              movable ||
              block.onStart !== undefined ||
              block.onRemove !== undefined;
            const isShadow = dragged?.key === block.key;
            return (
              <div
                key={block.key}
                className={cx(
                  "wr-daygrid-item",
                  movable && "wr-daygrid-item-movable",
                  isShadow && "wr-daygrid-item-shadow",
                )}
                style={{
                  top,
                  height: blockHeight,
                  left: `${(column / columns) * 100}%`,
                  width: `${(span / columns) * 100}%`,
                }}
                {...(keyed ? handles(block) : {})}
              >
                {block.node}
              </div>
            );
          },
        )}
      </div>

      {/* Fixed to the viewport and following the cursor exactly. Rendered
          outside the lanes so nothing can clip it - the range label hanging off
          its top edge was being cut off by the block's own overflow. */}
      {dragged ? (
        <div
          className="wr-daygrid-float"
          style={floatBox(surface.current, placed, dragged)}
        >
          <span className="wr-daygrid-range">
            {label.format(new Date(dragged.startsAt))}–
            {label.format(new Date(dragged.endsAt))}
          </span>
          {items.find((item) => item.key === dragged.key)?.node}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Where the floating card goes.
 *
 * It follows the cursor exactly, and stops at the edges of the day. Both halves
 * matter: a card that snaps as you move it feels like it is fighting you, and a
 * card that sails off over the header while its shadow is pinned to nine in the
 * morning is two answers to one question. Clamped, the card and the shadow
 * agree everywhere, including at the ends.
 *
 * It also keeps the width it had on the surface, so picking a block up does not
 * resize it under the cursor.
 */
const floatBox = (
  surface: HTMLElement | null,
  placed: readonly PlacedBlock<DayGridItem>[],
  drag: { key: string; x: number; y: number; grabX: number; grabY: number },
): React.CSSProperties => {
  const lanes = surface?.querySelector(".wr-daygrid-lanes");
  const box = placed.find((entry) => entry.block.key === drag.key);
  if (!lanes || !box) {
    return { left: drag.x - drag.grabX, top: drag.y - drag.grabY };
  }

  const bounds = lanes.getBoundingClientRect();
  const width = (bounds.width * box.span) / box.columns;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), Math.max(low, high));

  return {
    left: clamp(drag.x - drag.grabX, bounds.left, bounds.right - width),
    top: clamp(drag.y - drag.grabY, bounds.top, bounds.bottom - box.height),
    width,
  };
};

export const DashedRow: React.FC<{
  children: React.ReactNode;
  gutter?: boolean;
  onClick?: () => void;
}> = ({ children, gutter = true, onClick }) => (
  <div className="wr-slot-row">
    {gutter ? <div className="wr-time" /> : null}
    {onClick ? (
      <button type="button" className="wr-dashed-row" onClick={onClick}>
        {children}
      </button>
    ) : (
      <div className="wr-dashed-row">{children}</div>
    )}
  </div>
);

/* ── Rail modules ────────────────────────────────────────────────────────── */

export type ModuleProps = {
  /** attention = the app's single loudest element; one per screen. */
  variant?: "default" | "attention";
  eyebrow?: string;
  count?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export const Module: React.FC<ModuleProps> = ({
  variant = "default",
  eyebrow,
  count,
  children,
  className,
  style,
}) => (
  <section
    className={cx(
      "wr-module",
      variant === "attention" && "wr-module-attention",
      className,
    )}
    style={style}
  >
    {eyebrow ? (
      <div className="wr-module-head">
        <span className="wr-label">{eyebrow}</span>
        {count !== undefined ? <Chip variant="static">{count}</Chip> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const ModuleEmpty: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
}> = ({ children, onClick }) => (
  <button type="button" className="wr-module wr-module-empty" onClick={onClick}>
    <span
      style={{
        font: "400 15px var(--font-body)",
        color: "var(--wr-text-soft)",
      }}
    >
      +
    </span>
    {children}
  </button>
);

/** Progress against a minimum - never a goal, never a streak to protect. */
export const Metric: React.FC<{
  label: string;
  value: string;
  /** 0–1 */
  progress: number;
  tone?: "recovery" | "focus";
}> = ({ label, value, progress, tone = "recovery" }) => (
  <div className="wr-metric">
    <div className="wr-metric-head">
      <span>{label}</span>
      <span>{value}</span>
    </div>
    <div className={cx("wr-bar", tone === "focus" && "wr-bar-ink")}>
      <div className="wr-bar-fill" style={{ width: `${progress * 100}%` }} />
    </div>
  </div>
);

/* ── Structure & metadata ────────────────────────────────────────────────── */

export const SourceMark: React.FC<{ provider: string }> = ({ provider }) => (
  <span className="wr-source">{provider}</span>
);

export const LiveStatus: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <span className="wr-status">
    <span className="wr-dot" />
    {children}
  </span>
);

/**
 * The stroke thickens as the mark shrinks.
 *
 * The design's own ramp, and it is not decoration: the two arcs are the whole
 * idea, and at 16px a 12-unit stroke closes into a smudge you cannot read as
 * two separate things. Sizes between the listed steps round down to the
 * heavier stroke, which is the safe direction.
 */
const markStroke = (size: number): number =>
  size >= 44
    ? 12
    : size >= 38
      ? 13
      : size >= 28
        ? 14
        : size >= 26
          ? 15
          : size >= 22
            ? 16
            : 18;

/**
 * The mark: a terracotta disc, with the day drawn round it.
 *
 * The sand arc is booked time and the ink arc is the slot placed in the gap
 * after it - the product's one idea, at 28px. The ring starts at twelve
 * o'clock, which is what the `rotate(-90)` is for: SVG arcs begin at three.
 *
 * Colours are literal rather than tokens on purpose. A logo that changes
 * because someone retuned the interface palette is not a logo.
 */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 120 120"
    // The wordmark beside it already says the name; a second copy here would
    // be read out twice.
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="60" cy="60" r="58" fill="#c67139" />
    <g
      transform="rotate(-90 60 60)"
      fill="none"
      strokeWidth={markStroke(size)}
      strokeLinecap="round"
    >
      <circle
        cx="60"
        cy="60"
        r="38"
        stroke="#f2e0bd"
        strokeDasharray="96 143"
        strokeDashoffset="-10"
      />
      <circle
        cx="60"
        cy="60"
        r="38"
        stroke="#2e2b25"
        strokeDasharray="54 185"
        strokeDashoffset="-142"
      />
    </g>
  </svg>
);

/**
 * One setting inside a card.
 *
 * The card groups; the block is the thing itself. Calendars already draws this
 * way - a raised card holding hairline-bordered rows - and settings was
 * drawing every individual setting as its own raised card, which said each one
 * was a separate object of the same weight as the group it belonged to.
 *
 * `footer` is where a save belongs. A typed value needs an explicit commit,
 * and putting that commit at the foot of the block it commits makes it
 * unambiguous which values it is about - a single Update under the whole
 * section cannot say.
 */
export const Block: React.FC<{
  title?: string;
  /** The line under the title, for what the title cannot say. */
  note?: string;
  /** A control set against the title - a toggle, or a segmented choice. These
   *  commit the moment they change, so they never appear in `footer`. */
  action?: React.ReactNode;
  children?: React.ReactNode;
  /** Shown only when there is something to commit. */
  footer?: React.ReactNode;
}> = ({ title, note, action, children, footer }) => {
  // Names the section after its own heading, so the block is a landmark
  // rather than an anonymous <section>: "the Update inside Working hours" is
  // then something a screen reader - and a test - can actually address, where
  // before the only way to tell two Updates apart was which class they sat in.
  const headingId = useId();

  return (
    <section
      className="wr-block"
      {...(title ? { "aria-labelledby": headingId } : {})}
    >
      {title || note || action ? (
        <header className="wr-block-head">
          <div className="wr-block-heading">
            {title ? (
              <h4 className="wr-block-title" id={headingId}>
                {title}
              </h4>
            ) : null}
            {note ? <p className="wr-block-note">{note}</p> : null}
          </div>
          {action ? <div className="wr-block-action">{action}</div> : null}
        </header>
      ) : null}
      {children ? <div className="wr-block-body">{children}</div> : null}
      {footer ? <div className="wr-block-foot">{footer}</div> : null}
    </section>
  );
};

/* ── When something went wrong ───────────────────────────────────────────── */

export interface ToastMessage {
  id: string;
  text: string;
  /**
   * One way back, for a message reporting something the user can undo.
   *
   * A toast is the only place an undo can live for an action taken with a
   * keypress: there is no dialog to put it in, and a confirmation on every
   * press would defeat the shortcut it is confirming.
   */
  action?: { label: string; onClick: () => void };
}

/**
 * What a failed background save says.
 *
 * A setting that commits on click has no button left to report through, so
 * the failure needs somewhere else to appear - and it has to appear *near the
 * thing*, which is why this is an in-app layer rather than an OS notification.
 * A system notification for "couldn't save that toggle" arrives outside the
 * window the user is looking at, needs a permission they have to grant first,
 * and is silently dropped by Do Not Disturb.
 *
 * `alert`, not `status`: every message here is something that did not happen.
 */
export const Toasts: React.FC<{
  items: readonly ToastMessage[];
  onDismiss?: (id: string) => void;
}> = ({ items, onDismiss }) =>
  items.length === 0 ? null : (
    <div className="wr-toasts" role="alert" aria-live="assertive">
      {items.map((item) => (
        <div className="wr-toast" key={item.id}>
          <span className="wr-toast-text">{item.text}</span>
          {item.action ? (
            <button
              type="button"
              className="wr-toast-action"
              onClick={() => {
                item.action?.onClick();
                onDismiss?.(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="wr-toast-close"
            aria-label="Dismiss"
            onClick={() => onDismiss?.(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );

/**
 * Waiting for a page's first load.
 *
 * Centred in whatever it is given, rather than a line of text in the top-left
 * corner - which is where every route used to put it, and which reads as a
 * page that has finished and has almost nothing on it.
 *
 * `role="status"` rather than `alert`: a screen reader should hear this when
 * it gets to it, not have the current sentence interrupted for it.
 */
export const Loading: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => (
  <div className="wr-loading" role="status">
    <span className="wr-loading-spin" aria-hidden="true" />
    {children ? <span className="wr-loading-text">{children}</span> : null}
  </div>
);

export type CardProps = {
  /**
   * What this card is. Rendered as the card's own heading rather than as a
   * label on the control inside it - Account had four of these blocks naming
   * themselves four different ways, two through a field label and two through
   * a loose span, and they read as four different kinds of object.
   */
  title?: string;
  /** A line under the title, for the thing the title cannot say. */
  note?: string;
  /** An action belonging to this card, set against the title. */
  action?: React.ReactNode;
  /**
   * "dark" is the inverted block from the design - same shape and padding,
   * heavier. For the one thing on a first run worth looking at, and not for
   * anything competing with a neighbour.
   */
  tone?: "light" | "dark";
  children?: React.ReactNode;
};

/**
 * The one raised block.
 *
 * Every grouped thing on a settings page is one of these: same ground, same
 * radius, same lift. Calendars was drawing the same groups flat while Account
 * drew them raised, which said the two pages were built out of different
 * materials when they are not.
 *
 * A card with no title is still a card - the grouping is the point, and the
 * heading is only there when the group needs naming.
 */
export const Card: React.FC<CardProps> = ({
  title,
  note,
  action,
  tone = "light",
  children,
}) => (
  <section className={cx("wr-card", tone === "dark" && "wr-card-dark")}>
    {title || note || action ? (
      <header className="wr-card-head">
        <div className="wr-card-heading">
          {title ? <h3 className="wr-card-title">{title}</h3> : null}
          {note ? <p className="wr-card-note">{note}</p> : null}
        </div>
        {action ? <div className="wr-card-action">{action}</div> : null}
      </header>
    ) : null}
    {children}
  </section>
);

export interface SetupStep {
  key: string;
  label: string;
  /** Shown only while this is the step in hand. */
  detail?: string;
  done?: boolean;
  /** The one action the step offers. Omit for a step that is only a tick. */
  action?: { label: string; onClick: () => void };
}

export type SetupModuleProps = {
  steps: readonly SetupStep[];
  /**
   * Removes the module for good - the caller has to remember that. Omit it and
   * there is no way out but finishing, which is right when every step is
   * something the app cannot work without.
   */
  onDismiss?: () => void;
  /**
   * "dark" is the one from the design: near-black, and the only object on the
   * page carrying that weight. It is for the first run, where the day behind
   * it is empty and this is genuinely the thing to look at. "light" is the
   * same module once it is one of several in the rail and no longer deserves
   * to shout.
   */
  tone?: "light" | "dark";
};

/**
 * The "you are not set up yet" module, and its own way out.
 *
 * A module in the rail rather than a wizard in front of the app. Someone who
 * has just signed in should be looking at their day, not at a sequence of
 * screens standing between them and it - and the day is the thing that makes
 * the ask make sense, because it is visibly empty.
 *
 * Only the step in hand carries its explanation and its button. The ones after
 * it are titles, because a checklist that argues for all of itself at once is
 * a wall of text; the ones behind it are ticks.
 */
export const SetupModule: React.FC<SetupModuleProps> = ({
  steps,
  onDismiss,
  tone = "light",
}) => {
  const done = steps.filter((step) => step.done).length;
  const current = steps.find((step) => !step.done);

  return (
    <Card
      tone={tone}
      title="Set up"
      action={
        <span className="wr-setup-count">
          {done} of {steps.length}
        </span>
      }
    >
      <ol className="wr-setup-steps">
        {steps.map((step) => {
          const active = step.key === current?.key;
          return (
            <li
              key={step.key}
              className={cx(
                "wr-setup-step",
                step.done && "wr-setup-step-done",
                active && "wr-setup-step-active",
              )}
            >
              {/* The tick belongs to the label it marks. Everything below is a
                  sibling of that row rather than a child of it, so the detail
                  and the button start at the step's own left edge instead of
                  being pushed in to clear a circle they have nothing to do
                  with. */}
              <div className="wr-setup-row">
                <span className="wr-setup-tick" aria-hidden="true">
                  {step.done ? "✓" : null}
                </span>
                <span className="wr-setup-label">{step.label}</span>
              </div>

              {active && step.detail ? (
                <p className="wr-setup-detail">{step.detail}</p>
              ) : null}

              {active && step.action ? (
                tone === "dark" ? (
                  <button
                    type="button"
                    className="wr-setup-go"
                    onClick={step.action.onClick}
                  >
                    {step.action.label}
                  </button>
                ) : (
                  <Button variant="primary" onClick={step.action.onClick}>
                    {step.action.label}
                  </Button>
                )
              ) : null}
            </li>
          );
        })}
      </ol>

      {onDismiss ? (
        <button type="button" className="wr-setup-skip" onClick={onDismiss}>
          Skip for now
        </button>
      ) : null}
    </Card>
  );
};

/**
 * A centred sheet over a dimmed page.
 *
 * Used where a choice has to be finished before the app makes sense again -
 * picking a provider and then picking calendars. Escape and a click on the
 * backdrop both close it, because a dialog that can only be dismissed by the
 * one button it wants pressed is a trap.
 */
export const Modal: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ title, subtitle, onClose, children, footer }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wr-overlay">
      {/* A real button rather than a click handler on the backdrop: it is
          reachable by keyboard, it announces itself, and it removes the
          stop-propagation dance that a clickable parent would need. */}
      <button
        type="button"
        className="wr-overlay-back"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <div
        className="wr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="wr-sheet-head">
          <div>
            <h2 className="wr-sheet-title">{title}</h2>
            {subtitle ? <p className="wr-sheet-sub">{subtitle}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </header>
        <div
          className={cx(
            "wr-sheet-body",
            footer !== undefined && "wr-sheet-body-above-foot",
          )}
        >
          {children}
        </div>
        {footer ? <div className="wr-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
};

/** The providers we can read a calendar from. */
const CALENDAR_PROVIDERS = [
  {
    key: "google" as const,
    mark: "G",
    name: "Google Calendar",
    note: "Opens your browser to sign in",
  },
  {
    key: "microsoft" as const,
    mark: "M",
    name: "Outlook / Microsoft 365",
    note: "Work accounts may need an admin to approve",
  },
];

export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number]["key"];

/**
 * Pick a provider, and say plainly what connecting one costs.
 *
 * The paragraph underneath is not boilerplate. This is the moment someone
 * hands over their calendar, and "what we take, in plain terms" answers the
 * question they are actually asking before they have to go looking for a
 * privacy page to find it.
 */
export const ProviderChoice: React.FC<{
  onChoose: (provider: CalendarProvider) => void;
  /** The one being opened, if any - its row shows the wait. */
  busy?: CalendarProvider | null;
}> = ({ onChoose, busy }) => (
  <>
    <ul className="wr-providers">
      {CALENDAR_PROVIDERS.map((provider) => (
        <li key={provider.key} className="wr-provider">
          <span className="wr-provider-mark" aria-hidden="true">
            {provider.mark}
          </span>
          <div className="wr-provider-body">
            <div className="wr-provider-name">{provider.name}</div>
            <div className="wr-provider-note">{provider.note}</div>
          </div>
          <Button
            variant="secondary"
            onClick={() => onChoose(provider.key)}
            disabled={busy !== null && busy !== undefined}
          >
            {busy === provider.key ? "Opening…" : "Connect"}
          </Button>
        </li>
      ))}
    </ul>

    <div className="wr-provider-terms">
      <div className="wr-provider-terms-title">
        What we take, in plain terms
      </div>
      <p>
        Event titles, times and busy status - that is all we read. We never
        write to your calendar, never open attachments, notes or attendee lists,
        and nothing leaves your machine except the times we need to schedule
        around.
      </p>
    </div>
  </>
);

export interface PickableCalendar {
  id: string;
  name: string;
  isSelected: boolean;
  /** "32 events this week", "all-day only" - whatever helps them choose. */
  note?: string;
  isPrimary?: boolean;
}

/**
 * Which calendars to read.
 *
 * Only reading is on offer: the design had a "write my slots to" step, and it
 * is deliberately not here, because the app does not write to anyone's
 * calendar. Offering the choice would be describing a capability that does not
 * exist.
 */
export const CalendarPicker: React.FC<{
  calendars: readonly PickableCalendar[];
  onToggle: (id: string, isSelected: boolean) => void;
  /** Ids mid-flight, so a slow toggle cannot be double-pressed. */
  pending?: readonly string[];
}> = ({ calendars, onToggle, pending = [] }) => (
  <ul className="wr-calpick">
    {calendars.map((calendar) => (
      <li key={calendar.id} className="wr-calpick-row">
        <label className="wr-calpick-label">
          <input
            type="checkbox"
            className="wr-calpick-box"
            checked={calendar.isSelected}
            disabled={pending.includes(calendar.id)}
            onChange={(event) => onToggle(calendar.id, event.target.checked)}
          />
          <span className="wr-calpick-body">
            <span className="wr-calpick-name">
              {calendar.name}
              {calendar.isPrimary ? (
                <span className="wr-calpick-primary">primary</span>
              ) : null}
            </span>
            {calendar.note ? (
              <span className="wr-calpick-note">{calendar.note}</span>
            ) : null}
          </span>
        </label>
      </li>
    ))}
  </ul>
);

export type UpdatePillProps = {
  /** The version waiting to be installed. */
  version: string;
  /** 0–100 while installing, `null` when the server sent no length, and
   *  absent until the user actually starts it. */
  percent?: number | null;
  /** Set when an install failed. The pill becomes a retry. */
  problem?: string;
  onInstall: () => void;
};

/**
 * "There is a new version" - the whole of it.
 *
 * A pill in the rail rather than a dialog. An update is not urgent and has no
 * decision in it worth interrupting someone mid-sentence for; it is a thing
 * that is ready when they are. Once running it stops being a button, because
 * the one action it offered is already happening and the app is about to
 * restart underneath them.
 *
 * The bar is a width, not a spinner: a download that cannot report a total -
 * a redirect to a CDN that sends no `Content-Length` - gets a quiet
 * indeterminate stripe rather than a percentage nobody can trust.
 */
export const UpdatePill: React.FC<UpdatePillProps> = ({
  version,
  percent,
  problem,
  onInstall,
}) => {
  const installing = percent !== undefined && !problem;

  return (
    <button
      type="button"
      className={cx("wr-update", installing && "wr-update-busy")}
      onClick={installing ? undefined : onInstall}
      disabled={installing}
      // The version is the useful part for anyone reading this aloud; the
      // visible text is short because the rail is 200px wide.
      aria-label={
        problem
          ? `Update to ${version} failed. ${problem}. Try again.`
          : installing
            ? `Installing version ${version}`
            : `Update to version ${version} and restart`
      }
    >
      {installing ? null : <span className="wr-dot" />}
      <span className="wr-update-text">
        {problem
          ? "Update failed - retry"
          : installing
            ? "Installing…"
            : `Update to ${version}`}
      </span>
      {installing ? (
        <span
          className={cx(
            "wr-update-bar",
            percent === null && "wr-update-bar-unknown",
          )}
        >
          <span
            className="wr-update-bar-fill"
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </span>
      ) : null}
    </button>
  );
};

export const NavItem: React.FC<{
  children: React.ReactNode;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}> = ({ children, active, count, onClick }) => (
  <button
    type="button"
    className={cx("wr-navitem", active && "wr-navitem-active")}
    onClick={onClick}
  >
    {children}
    {count !== undefined ? (
      <span className="wr-navitem-count">{count}</span>
    ) : null}
  </button>
);

/** Paused / Off rows: state carried by a hollow rule, a chip or an inset
 *  surface - the system has no opacity-based disabled state. */
export const StateRow: React.FC<{
  name: string;
  leading: React.ReactNode;
  trailing: React.ReactNode;
  recessed?: boolean;
}> = ({ name, leading, trailing, recessed }) => (
  <div
    className={cx("wr-slot", recessed && "wr-slot-inset")}
    style={{ width: 236, borderRadius: 15, flex: "none" }}
  >
    {leading}
    <div style={{ flex: 1 }}>
      <div className="wr-slot-name">{name}</div>
    </div>
    {trailing}
  </div>
);

/* ── Placement by hand ───────────────────────────────────────────────────── */

/**
 * A slot mid-drag: the target stretch, and the card following the cursor.
 *
 * Two elements rather than a `Slot` variant, because that is what it is - the
 * drop target reads its own range so the placement is legible even with the
 * card somewhere else. The card offsets down and right so both stay readable;
 * it does not tilt, scale or fade.
 *
 * The target is accent-**200** with a solid ring where `suggested` is
 * accent-100 with a light one: a live drag is louder than a standing proposal,
 * and the two never appear at once.
 */
export const DragPlacement: React.FC<{
  time: string;
  /** The range the drop would produce, e.g. "11:30–11:40". */
  range: string;
  name: string;
  /** The live time chip on the floating card. */
  at: string;
}> = ({ time, range, name, at }) => (
  <div className="wr-slot-row">
    <div className="wr-time">{time}</div>
    <div className="wr-drag">
      <div className="wr-drag-target">Drop here · {range}</div>
      <div className="wr-drag-card">
        <span className="wr-grip">⋮⋮</span>
        <span className="wr-rule" />
        <span className="wr-slot-name">{name}</span>
        <span className="wr-slot-trailing">
          <Chip variant="selected">{at}</Chip>
        </span>
      </div>
    </div>
  </div>
);

/**
 * Setting a time by hand.
 *
 * The step size and the consequence are stated beside the value rather than
 * inferred from the widget - "5 min steps · ends 11:15" is the whole point,
 * since a stepper alone never says what it costs you.
 */
export const TimeStepper: React.FC<{
  value: string;
  /** Stated, not implied: step size and what the change produces. */
  note?: string;
  onStep?: (direction: -1 | 1) => void;
}> = ({ value, note, onStep }) => (
  <div className="wr-stepper-row">
    <div className="wr-stepper">
      <button
        type="button"
        className="wr-stepper-btn"
        aria-label="Earlier"
        onClick={() => onStep?.(-1)}
      >
        −
      </button>
      <span className="wr-stepper-value">{value}</span>
      <button
        type="button"
        className="wr-stepper-btn"
        aria-label="Later"
        onClick={() => onStep?.(1)}
      >
        +
      </button>
    </div>
    {note ? <span className="wr-stepper-note">{note}</span> : null}
  </div>
);

/**
 * The wide sibling of `TimeStepper`: a field in a form rather than a detail
 * beside a slot, so it names itself and fills its column.
 *
 * The ends of the range disable rather than silently ignore a press. A stepper
 * that keeps accepting clicks and never changes is the one thing worse than
 * one that stops.
 */
export const Stepper: React.FC<{
  label: string;
  value: string;
  onStep?: (direction: -1 | 1) => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
}> = ({ label, value, onStep, canDecrease = true, canIncrease = true }) => (
  <div className="wr-field">
    <span className="wr-label">{label}</span>
    <div className="wr-stepper wr-stepper-wide">
      <button
        type="button"
        className="wr-stepper-btn"
        aria-label={`${label}: less`}
        disabled={!canDecrease}
        onClick={() => onStep?.(-1)}
      >
        −
      </button>
      <span className="wr-stepper-value">{value}</span>
      <button
        type="button"
        className="wr-stepper-btn"
        aria-label={`${label}: more`}
        disabled={!canIncrease}
        onClick={() => onStep?.(1)}
      >
        +
      </button>
    </div>
  </div>
);

/**
 * Which days of the week something happens on.
 *
 * Seven toggles and nothing else - no "every day / weekdays / custom" mode
 * above them. All seven on *is* every day, so a mode selector would be a
 * second control saying what the first one already shows, and the two would
 * have to be kept in step. The summary underneath does that job instead: it
 * names the sets people actually mean rather than listing five day names and
 * leaving the reader to notice they add up to "weekdays".
 *
 * Turning the last day off is allowed. It produces an activity that never
 * runs, which is a thing to *say* - the summary says it - rather than a click
 * to silently swallow.
 */
export const DayPicker: React.FC<{
  label?: string;
  /** The seven-bit mask, Sunday = bit 0. */
  value: number;
  onChange?: (next: number) => void;
}> = ({ label = "Which days", value, onChange }) => (
  <div className="wr-field">
    <span className="wr-label">{label}</span>
    <div className="wr-days" role="group" aria-label={label}>
      {WEEK_ORDER.map((day) => {
        const name = DAY_NAMES[day];
        const on = runsOnDay(value, day);
        return (
          <button
            key={name}
            type="button"
            className={cx("wr-day", on && "wr-day-on")}
            aria-pressed={on}
            aria-label={name}
            onClick={() => onChange?.(toggleDay(value, day))}
          >
            {name.slice(0, 1)}
          </button>
        );
      })}
    </div>
    <p className="wr-activity-hint">{daysLabel(value)}</p>
  </div>
);

/**
 * A behaviour turned on or off, with the sentence saying what it does.
 *
 * Inset, because it is one setting inside a form rather than an object in its
 * own right - the same surface a self-resolving clash drops to.
 */
export const SwitchRow: React.FC<{
  title: string;
  note?: string;
  checked: boolean;
  onChange?: (next: boolean) => void;
}> = ({ title, note, checked, onChange }) => (
  <div className="wr-switchrow">
    <div className="wr-switchrow-body">
      <span className="wr-body-strong">{title}</span>
      {note ? <span className="wr-slot-meta">{note}</span> : null}
    </div>
    <Toggle checked={checked} onChange={onChange} label={title} />
  </div>
);

/**
 * How well each part of the surrounding window fits this activity.
 *
 * A hint, never a control: it does not block a choice, and nothing about it is
 * clickable. Values are 0–1; anything above `strong` reads as the user's own
 * usual window.
 */
export const FitStrip: React.FC<{
  values: readonly number[];
  caption?: string;
}> = ({ values, caption }) => (
  <div>
    <div className="wr-fit">
      {values.map((v, i) => (
        <span
          // Position *is* the identity here - bar 3 is the third slice of the
          // window and nothing reorders. There is no state to mis-attach.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
          key={i}
          className={cx(
            "wr-fit-bar",
            v >= 0.66 ? "wr-fit-strong" : v >= 0.33 && "wr-fit-mid",
          )}
        />
      ))}
    </div>
    {caption ? <div className="wr-fit-caption">{caption}</div> : null}
  </div>
);

/**
 * A slot the user has to resolve.
 *
 * Two shapes, and which one you get is decided by whether there is a decision
 * to make. A genuine clash keeps its card and gains a second tier of escape
 * routes. A clash that resolves itself - a length change rather than a move -
 * drops to the inset surface with a neutral rule, because it is information
 * plus one button.
 */
export const ClashRow: React.FC<{
  name: string;
  /** Why it clashes, in the user's terms. */
  reason: string;
  /** Alternative times offered as choice chips. Omit for the self-resolving
   *  shape, which takes a single `action` instead. */
  alternatives?: readonly string[];
  alternativesLabel?: string;
  /** The quiet escape route, e.g. "Drop". */
  dismiss?: string;
  /** The one-button form: "Shorten". Presence of this switches the surface. */
  action?: string;
  onChoose?: (time: string) => void;
  onDismiss?: () => void;
  onAction?: () => void;
}> = ({
  name,
  reason,
  alternatives,
  alternativesLabel = "Free stretches nearby",
  dismiss,
  action,
  onChoose,
  onDismiss,
  onAction,
}) => {
  const selfResolving = action !== undefined;
  return (
    <div className={cx("wr-clash", selfResolving && "wr-clash-quiet")}>
      <div className="wr-clash-head">
        <span className={cx("wr-rule", selfResolving && "wr-rule-neutral")} />
        <div style={{ flex: 1 }}>
          <div className="wr-slot-name">{name}</div>
          <div
            className={cx("wr-clash-reason", selfResolving && "wr-slot-meta")}
          >
            {reason}
          </div>
        </div>
        {selfResolving ? (
          <Button variant="secondary" onClick={onAction}>
            {action}
          </Button>
        ) : null}
      </div>

      {alternatives ? (
        <div className="wr-clash-routes">
          <span className="wr-clash-routes-label">{alternativesLabel}</span>
          {alternatives.map((time) => (
            <Chip key={time} onClick={() => onChoose?.(time)}>
              {time}
            </Chip>
          ))}
          {dismiss ? (
            <Button variant="quiet" onClick={onDismiss}>
              {dismiss}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * How the product mentions Pro.
 *
 * Dashed edge, no fill, no shadow - the same treatment as an empty gap,
 * because that is what it is: absence of a capability rather than of space. It
 * states what *would have* happened, in past tense, and never covers, blocks
 * or dims the thing the user is doing. One per screen at most, and never on
 * the ink module.
 */
export const PlanNote: React.FC<{
  title: string;
  children?: React.ReactNode;
  action?: string;
  onAction?: () => void;
}> = ({ title, children, action = "See Pro", onAction }) => (
  <div className="wr-plan-note">
    <div style={{ flex: 1 }}>
      <div className="wr-plan-note-title">{title}</div>
      {children ? <div className="wr-plan-note-body">{children}</div> : null}
    </div>
    <Button variant="secondary" onClick={onAction}>
      {action}
    </Button>
  </div>
);

/** A keyboard hint - ⌘K, ↵, or a count. Monospace, never interactive. */
export const Keycap: React.FC<{
  children: React.ReactNode;
  tone?: "accent" | "neutral";
}> = ({ children, tone = "neutral" }) => (
  <span className={cx("wr-keycap", tone === "accent" && "wr-keycap-accent")}>
    {children}
  </span>
);

/**
 * An `https:` URL, and nothing else.
 *
 * Providers do not agree on what a picture is. Google sends a URL; Entra sends
 * the image itself, base64 in the profile, big enough to blow past header
 * limits and far too big to sit in a database column that every session read
 * touches. So the rule is the narrow one: a real URL renders, anything else -
 * `data:`, a bare path, an empty string - is treated as no picture at all and
 * falls back to initials, which always work.
 */
const isImageUrl = (src: string | null | undefined): src is string =>
  typeof src === "string" && /^https:\/\//i.test(src);

/** The user's mark. Initials when there is no image - never an icon. */
export const Avatar: React.FC<{
  name: string;
  size?: number;
  /** Ignored unless it is an `https:` URL. */
  src?: string | null;
}> = ({ name, size = 24, src }) => {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  if (isImageUrl(src)) {
    return (
      <img
        className="wr-avatar"
        style={{ width: size, height: size }}
        src={src}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="wr-avatar"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};
