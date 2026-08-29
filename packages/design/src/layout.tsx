import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  BrandMark,
  IconButton,
  Keycap,
  NavItem,
  RefreshGlyph,
} from "./components";
import { agoOf } from "./time";

/**
 * The app frame.
 *
 * Sand chrome, near-white page, lifted content. The window bar, the sidebar
 * and any settings pane share **one** tone (neutral-200) so nothing looks like
 * a different app - that single rule is what stops a settings screen reading
 * as a separate product.
 *
 * The page never carries a headline. The date sits inline with a helper
 * sentence, and everything explanatory belongs in the rail.
 */

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/** The traffic-light bar. Decorative on web; the real one is Tauri's. */
export const WindowBar: React.FC<{ title?: string }> = ({
  title = "Wise Routine",
}) => (
  <div className="wr-windowbar">
    <span className="wr-dot" />
    <span className="wr-dot" />
    <span className="wr-dot" />
    <span className="wr-windowbar-title">{title}</span>
  </div>
);

export interface NavEntry {
  key: string;
  label: string;
  /** Reminders carries the undated count; everything else omits it. */
  count?: number;
}

/**
 * The user row, and what it opens.
 *
 * A popover rather than a drawer: it is a short list of destinations, and the
 * sidebar is already the navigation. It sits at Lift 3 - the floating-surface
 * elevation, shared with the live slot and dialogs, because only one thing may
 * be off the page at a time.
 */
export const UserMenu: React.FC<{
  name: string;
  email?: string;
  /** Ignored unless it is an `https:` URL - see `Avatar`. */
  avatarSrc?: string | null;
  /** "free" reads as plain text; "pro" earns the chip. */
  plan?: "free" | "pro";
  items?: readonly { key: string; label: string }[];
  onSelect?: (key: string) => void;
}> = ({
  name,
  email,
  avatarSrc,
  plan = "free",
  items = [
    { key: "settings", label: "Settings" },
    { key: "calendars", label: "Calendars & connections" },
    { key: "account", label: "Account" },
    { key: "signout", label: "Sign out" },
  ],
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A popover that survives a click elsewhere is a popover people fight with.
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
    <div className="wr-usermenu" ref={root}>
      {open ? (
        <div className="wr-usermenu-pop" role="menu">
          <div className="wr-usermenu-head">
            <Avatar
              name={name}
              size={32}
              {...(avatarSrc !== undefined ? { src: avatarSrc } : {})}
            />
            <div style={{ minWidth: 0 }}>
              <div className="wr-usermenu-name">{name}</div>
              {email ? <div className="wr-usermenu-email">{email}</div> : null}
            </div>
            {plan === "pro" ? <span className="wr-badge">Pro</span> : null}
          </div>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="wr-usermenu-item"
              onClick={() => {
                setOpen(false);
                onSelect?.(item.key);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="wr-usermenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar
          name={name}
          {...(avatarSrc !== undefined ? { src: avatarSrc } : {})}
        />
        <span className="wr-usermenu-trigger-name">{name}</span>
      </button>
    </div>
  );
};

/**
 * The left rail.
 *
 * Brand, destinations, an optional module, then the two things that are always
 * within reach: quick add and the user. `children` is the module slot - the
 * sidebar itself has no opinion about what goes there.
 */
export const Sidebar: React.FC<{
  items: readonly NavEntry[];
  active: string;
  onNavigate?: (key: string) => void;
  children?: React.ReactNode;
  quickAdd?: string;
  onQuickAdd?: () => void;
  user?: React.ReactNode;
}> = ({
  items,
  active,
  onNavigate,
  children,
  quickAdd = "Quick add",
  onQuickAdd,
  user,
}) => (
  <nav className="wr-sidebar">
    <div className="wr-brand">
      <BrandMark size={28} />
      <span className="wr-brand-name">Wise Routine</span>
    </div>

    <div className="wr-nav">
      {items.map((item) => (
        <NavItem
          key={item.key}
          active={item.key === active}
          {...(item.count !== undefined ? { count: item.count } : {})}
          onClick={() => onNavigate?.(item.key)}
        >
          {item.label}
        </NavItem>
      ))}
    </div>

    {children}

    <div className="wr-sidebar-foot">
      {/* Only when something is listening. It rendered unconditionally, which
          put a button and a ⌘K hint in the rail of an app that had neither -
          a shortcut advertised and not bound is worse than one not offered. */}
      {onQuickAdd ? (
        <button type="button" className="wr-quickadd" onClick={onQuickAdd}>
          <span>+ {quickAdd}</span>
          <Keycap>⌘K</Keycap>
        </button>
      ) : null}
      {user}
    </div>
  </nav>
);

/**
 * Window bar, sidebar, content - the shape every screen is composed into.
 *
 * `header` is the inline date-plus-helper line rather than a page title, and
 * `rail` is the right-hand module column. Both are optional so a screen that
 * genuinely has neither (a running session, say) is not forced to fake one.
 */
export const AppFrame: React.FC<{
  sidebar: React.ReactNode;
  header?: React.ReactNode;
  rail?: React.ReactNode;
  /**
   * Keep the rail's column even on a page with no modules in it.
   *
   * The app sets this everywhere. Without it the main content grew by the
   * width of the rail the moment you left Today, so the same settings form was
   * one width on Account and another on Calendars, and every navigation
   * reflowed the page - which reads as two different apps rather than two
   * pages of one.
   */
  reserveRail?: boolean;
  children: React.ReactNode;
  /** Renders the traffic lights. Off inside the gallery, where it is noise. */
  chrome?: boolean;
}> = ({ sidebar, header, rail, reserveRail, children, chrome = true }) => (
  <div className={cx("wr-frame", !chrome && "wr-frame-bare")}>
    {chrome ? <WindowBar /> : null}
    <div className="wr-frame-body">
      {sidebar}
      <main className="wr-page">
        {header ? <div className="wr-page-head">{header}</div> : null}
        <div className="wr-page-body">
          <div className="wr-page-main">{children}</div>
          {rail || reserveRail ? (
            <aside className="wr-rail">{rail}</aside>
          ) : null}
        </div>
      </main>
    </div>
  </div>
);

/**
 * The frame for the screens that come before an account exists.
 *
 * Not `AppFrame` with the sidebar left out: there is no navigation to show and
 * no user to name, and the page *does* carry a headline here - which the app
 * shell forbids. Two different rules, so two different frames.
 */
export const AuthFrame: React.FC<{
  children: React.ReactNode;
  /** Renders the traffic lights. Off inside the gallery, where it is noise. */
  chrome?: boolean;
}> = ({ children, chrome = true }) => (
  <div className={cx("wr-auth", !chrome && "wr-auth-bare")}>
    {chrome ? <WindowBar /> : null}
    <div className="wr-auth-body">
      <div className="wr-auth-mark">
        <i />
        <span>Wise Routine</span>
      </div>
      {children}
    </div>
  </div>
);

/** The inline date line. Not a headline - the system forbids one here. */
export const PageHead: React.FC<{
  date: string;
  helper?: string;
  trailing?: React.ReactNode;
}> = ({ date, helper, trailing }) => (
  <>
    <div className="wr-page-head-left">
      <span className="wr-page-date">{date}</span>
      {helper ? <span className="wr-page-helper">{helper}</span> : null}
    </div>
    {trailing}
  </>
);

/**
 * Everything you do *to* a day, in one object.
 *
 * These used to sit at opposite ends of the header, on the argument that
 * changing what you are looking at and going to fetch it are different classes
 * of act. True, and it still left the two controls a page apart with the date
 * between them, so using either meant crossing the whole header - and the
 * refresh button reported nothing, so the one question it exists to answer
 * ("is this current?") had no answer anywhere on screen.
 *
 * So: one group, held to the right. What the day shows, going to get it, and
 * what going to get it last achieved - in that order, so the status sits
 * against the button it reports on rather than across the header from it. The
 * date leads and stays the largest thing here: it is the page's title, not a
 * member of the toolbar.
 */
export const DayBar: React.FC<{
  /** The hours picker, already configured. Passed in rather than built here,
   *  so the bar never has to know what a range is. */
  hours?: React.ReactNode;
  date: string;
  /** The window on screen, e.g. "08:30–17:30". */
  span?: string;
  onRefresh?: () => void;
  syncing?: boolean;
  /**
   * When a calendar last came back with an answer, and the clock to measure it
   * against. Null - nothing has ever synced - draws no status at all: "never"
   * is not news to someone who has not connected a calendar yet.
   */
  syncedAt?: number | null;
  now?: number;
}> = ({ hours, date, span, onRefresh, syncing, syncedAt, now }) => {
  const status = syncing
    ? "Syncing…"
    : syncedAt != null && now !== undefined
      ? `Synced ${agoOf(syncedAt, now)}`
      : null;

  return (
    <header className="wr-shell-head wr-shell-head-bar wr-page-bar wr-daybar">
      <div className="wr-daybar-title">
        <span className="wr-page-date">{date}</span>
        {span ? <span className="wr-page-helper">{span}</span> : null}
      </div>

      {/* The two controls, then what the second of them last achieved - so the
          status sits against the button it belongs to, and the whole group
          against the edge. */}
      <div className="wr-daybar-tools">
        {hours}
        {hours && onRefresh ? (
          <span className="wr-daybar-split" aria-hidden="true" />
        ) : null}
        {onRefresh ? (
          <IconButton
            label={syncing ? "Syncing your calendars" : "Sync calendars now"}
            busy={syncing ?? false}
            disabled={syncing ?? false}
            onClick={onRefresh}
          >
            <RefreshGlyph />
          </IconButton>
        ) : null}
        {status ? (
          // `role="status"` rather than a plain span: this changes on its own,
          // and a change nobody is told about is one only sighted users get.
          <span className="wr-daybar-sync" role="status">
            <span
              className={cx("wr-dot", syncing && "wr-dot-soft")}
              aria-hidden="true"
            />
            {status}
          </span>
        ) : null}
      </div>
    </header>
  );
};
