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

export type SlotVariant = "focus" | "recovery" | "live" | "meeting";

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
            {done ? (
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
