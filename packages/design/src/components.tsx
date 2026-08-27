import type React from "react";

const cx = (...parts: (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/** The one glyph the kit uses inline. Everything else is Lucide at
 *  stroke-width 2.75 — add `lucide-react` when the first screen needs it. */
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
    /** Overrides "Continue with X" — used for the waiting state, where the
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

/** "or" — between two routes to the same place. */
export const Rule: React.FC<{ children?: React.ReactNode }> = ({
  children = "or",
}) => <div className="wr-divider">{children}</div>;

export type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

/** A labelled pill. The label is real, not a placeholder: a placeholder
 *  disappears exactly when the user needs it to check what they typed. */
export const Field: React.FC<FieldProps> = ({
  label,
  id,
  className,
  ...rest
}) => {
  const inputId = id ?? `wr-field-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={cx("wr-field", className)}>
      <label className="wr-label" htmlFor={inputId}>
        {label}
      </label>
      <input id={inputId} className="wr-field-input" {...rest} />
    </div>
  );
};

export type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
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
  const inputId = id ?? `wr-select-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={cx("wr-field", className)}>
      <label className="wr-label" htmlFor={inputId}>
        {label}
      </label>
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
  /** Fired when the last digit lands — including on paste, which is the
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
          // is full — a caret past the last digit reads as "keep typing".
          const active = !wrong && index === digits.length && !disabled;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length row of positional boxes — the index is the identity, and there is no list to reorder.
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
 * For an action that is a verb the user already understands — refresh, close —
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
  options: readonly T[];
  value: T;
  onChange?: (next: T) => void;
  label?: string;
};

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>): React.ReactElement => (
  <div className="wr-seg" role="group" aria-label={label}>
    {options.map((opt) => (
      <button
        key={opt}
        type="button"
        aria-pressed={opt === value}
        className="wr-seg-opt"
        onClick={() => onChange?.(opt)}
      >
        {opt}
      </button>
    ))}
  </div>
);

/* ── Slot cards ──────────────────────────────────────────────────────────── */

export type SlotVariant =
  | "focus"
  | "recovery"
  | "live"
  | "meeting"
  /** Proposed by the scheduler, not yet accepted — Pro only. Accent-100 with a
   *  ring and no shadow: it is not a real thing on the page, so it must not
   *  lift. Free shows a `DashedRow` in the same position instead. */
  | "suggested";

export type SlotProps = {
  variant: SlotVariant;
  time: string;
  name: string;
  meta?: string;
  /** focus/recovery: the trailing element. Done state is a chip — never dim. */
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

/** Protected gap, add row, undated reminder — the one "nothing here yet" look. */
export interface DayGridItem {
  key: string;
  startsAt: number;
  endsAt: number;
  node: React.ReactNode;
}

export type DayGridProps = {
  /** Epoch ms bounding the visible day. */
  dayStart: number;
  dayEnd: number;
  /** The zone the labels are written in — the user's, never the device's. */
  timeZone: string;
  items: readonly DayGridItem[];
  /** Drawn only when it falls inside the window. */
  now?: number;
  /**
   * Height of one 15-minute step. Below ~22px the labels collide; below the
   * height of a slot card, short blocks are drawn taller than their duration
   * and start to overlap. 30 is the smallest that reads cleanly for both.
   */
  stepHeight?: number;
};

const QUARTER = 15 * 60_000;

/**
 * The day as a ruled surface rather than a list of rows.
 *
 * A list gives every slot its own start time and nothing to read them against,
 * so a day of 11:58, 12:23, 12:48 looks like a series of mistakes. It is not —
 * those are simply where the gaps were — but only a ruler makes that legible.
 * With one, the eye reads the quarter-hours and treats each block's exact edge
 * as detail, which is how every calendar people already know behaves.
 *
 * Blocks are positioned by time, so an item that does not start on a quarter
 * sits slightly below the line, deliberately.
 */
export const DayGrid: React.FC<DayGridProps> = ({
  dayStart,
  dayEnd,
  timeZone,
  items,
  now,
  stepHeight = 30,
}) => {
  const perMs = stepHeight / QUARTER;
  const height = Math.max(0, (dayEnd - dayStart) * perMs);
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const ticks: number[] = [];
  for (let at = dayStart; at <= dayEnd; at += QUARTER) ticks.push(at);

  return (
    <div className="wr-daygrid" style={{ height }}>
      {ticks.map((at) => {
        // The hour carries the weight; the quarters are there to measure
        // against, not to read one by one.
        const onTheHour = new Date(at).getTime() % (60 * 60_000) === 0;
        return (
          <div
            key={at}
            className={cx("wr-daygrid-tick", onTheHour && "wr-daygrid-hour")}
            style={{ top: (at - dayStart) * perMs }}
          >
            <span className="wr-daygrid-label">{label.format(new Date(at))}</span>
          </div>
        );
      })}

      {now !== undefined && now >= dayStart && now <= dayEnd ? (
        <div className="wr-daygrid-now" style={{ top: (now - dayStart) * perMs }}>
          <span className="wr-daygrid-now-label">{label.format(new Date(now))}</span>
        </div>
      ) : null}

      {items.map((item) => {
        const top = (Math.max(item.startsAt, dayStart) - dayStart) * perMs;
        const raw = (Math.min(item.endsAt, dayEnd) - Math.max(item.startsAt, dayStart)) * perMs;
        return (
          <div
            key={item.key}
            className="wr-daygrid-item"
            // A 15-minute block is shorter than the card inside it, so the
            // height is a floor rather than a clamp: better to overlap the
            // next line slightly than to clip a name to nothing.
            style={{ top, minHeight: Math.max(raw, stepHeight) }}
          >
            {item.node}
          </div>
        );
      })}
    </div>
  );
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

/** Progress against a minimum — never a goal, never a streak to protect. */
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
 *  surface — the system has no opacity-based disabled state. */
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
 * Two elements rather than a `Slot` variant, because that is what it is — the
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
 * inferred from the widget — "5 min steps · ends 11:15" is the whole point,
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
          // Position *is* the identity here — bar 3 is the third slice of the
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
 * routes. A clash that resolves itself — a length change rather than a move —
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
 * Dashed edge, no fill, no shadow — the same treatment as an empty gap,
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

/** A keyboard hint — ⌘K, ↵, or a count. Monospace, never interactive. */
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
 * touches. So the rule is the narrow one: a real URL renders, anything else —
 * `data:`, a bare path, an empty string — is treated as no picture at all and
 * falls back to initials, which always work.
 */
const isImageUrl = (src: string | null | undefined): src is string =>
  typeof src === "string" && /^https:\/\//i.test(src);

/** The user's mark. Initials when there is no image — never an icon. */
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
