import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  AppFrame,
  ScopeSwitcher,
  Sidebar,
  Toasts,
  UpdatePill,
  UserMenu,
} from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { setAccount, useAccount } from "../lib/account";
import { armAlerts } from "../lib/alerts";
import { ApiError, api, getSessionToken, setSessionToken } from "../lib/api";
import { dismiss, useToasts } from "../lib/notify";
import { useTodayPlan } from "../lib/plan-store";
import { dayLabel, periodLabel, scopeOf, todayOf } from "../lib/scope";
import "../lib/rail";
import { loadAddons } from "../addons/installed";
import { type AppUpdate, checkForUpdate, installUpdate } from "../lib/updates";
import { SessionOverlay } from "../modules/session";
import { TrialPill } from "../modules/trial-pill";

/**
 * The app shell every signed-in page renders inside.
 *
 * A pathless layout route, so a new page is a file rather than a file plus a
 * remembered wrapper - the chrome cannot drift between screens because there
 * is only one copy of it.
 *
 * Sign-in lives outside this route. Guarding here rather than in each page
 * means one place decides who gets in, and no page has to render a half-shell
 * for a session it does not have.
 */

/**
 * The destinations - which is now everything that is not a calendar scope.
 *
 * Today used to sit at the top of this list. It is a scope of the calendar,
 * not a fifth place to be, and listing it alongside Activities and Calendars
 * said the opposite: four rows, one of which quietly meant "the calendar, at
 * one particular zoom". Day, week, month and year moved into their own
 * bordered group above - see `ScopeSwitcher`.
 *
 * Reminders is still absent. It is in the design kit as the plan; a rail
 * entry with no route behind it is a dead click, and this list is the product.
 */
const NAV = [
  { key: "activities", label: "Activities", to: "/activities" },
  // The packages, not the cards they contribute - see `_app.addons`. Above
  // Settings because it is a place things are added, and below the two that
  // are the routine itself.
  { key: "addons", label: "Addons", to: "/addons" },
  { key: "calendars", label: "Calendars", to: "/calendars" },
  { key: "settings", label: "Settings", to: "/settings" },
] as const;

/** Where each scope of the calendar lives. */
const SCOPE_ROUTES = {
  day: "/",
  week: "/week",
  month: "/month",
  year: "/year",
} as const;

/** Sign out and nothing else. Settings is a destination in the rail above, and
 *  listing it twice made the menu look like it held more than it did. */
const USER_MENU = [{ key: "signout", label: "Sign out" }] as const;

/**
 * The rail's "there is a new version" pill, and nothing when there is not.
 *
 * Renders to nothing in the browser: `checkForUpdate` answers `null` off the
 * desktop, so the web build carries this component but never shows it.
 *
 * It re-checks on a timer as well as on mount. Someone who leaves the app open
 * for a fortnight - which is the normal way to use it - would otherwise only
 * ever learn about a release by quitting, which is the one thing they are not
 * doing.
 */
const RECHECK_HOURS = 6;

const UpdateNotice: React.FC = () => {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  /** `undefined` until the user starts it, then 0–100, or `null` for a
   *  download whose size the server never told us. */
  const [percent, setPercent] = useState<number | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const look = () => {
      void checkForUpdate().then((found) => {
        if (!cancelled) setUpdate(found);
      });
    };

    look();
    const timer = setInterval(look, RECHECK_HOURS * 60 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!update) return null;

  return (
    <UpdatePill
      version={update.version}
      {...(percent !== undefined ? { percent } : {})}
      {...(problem !== null ? { problem } : {})}
      onInstall={() => {
        setProblem(null);
        setPercent(null);
        // No `finally` resetting the spinner: on success this process is
        // replaced by the new version mid-promise, and there is nothing left
        // to reset.
        installUpdate(update, setPercent).catch((cause: unknown) => {
          setPercent(undefined);
          setProblem(cause instanceof Error ? cause.message : "Try again");
        });
      }}
    />
  );
};

/**
 * The menu bar and the notifications, driven from the shell.
 *
 * They used to be armed by an effect inside the Today page, which was fine for
 * as long as Today was the only place to be. It is not: the moment someone
 * opens the week, the month, or Settings, that effect unmounts and the menu bar
 * keeps whatever it was last told - which is how it ends up announcing
 * "Breathing · 2m" for an activity that ran, or was replanned away, twenty
 * minutes ago. Paging the day forward did the same thing.
 *
 * So it lives here, above every page, and reads today's plan rather than the
 * day on screen - see `useTodayPlan`. Nothing about a menu bar was ever a
 * property of one route.
 */
const useMenuBar = (): void => {
  const plan = useTodayPlan();

  // On the plan, and on nothing else. There was a thirty-second tick here
  // once, to move the countdown beside the icon along - and it was the bug:
  // closing the window hides it, macOS suspends a hidden webview's timers, and
  // the menu bar froze with it. The clock lives in `tray.rs` now, so this only
  // has to say when the day itself changes.
  useEffect(
    // No plan is a real answer, not a reason to skip: an empty schedule is
    // what clears a stale title off the bar.
    () => armAlerts(plan?.slots ?? []),
    [plan],
  );

  // In the shell rather than on the Today page: a session takes over whatever
  // page is open, so the addon that draws it has to be loaded whatever page
  // was open. Idempotent, and a failure leaves the app running without it.
  useEffect(() => {
    void loadAddons();
  }, []);
};

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  useMenuBar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The switcher names the period on screen, and the period lives in the URL -
  // see `lib/scope`. Reading it here rather than from the page keeps the shell
  // free of any page's state.
  const search = useRouterState({ select: (s) => s.location.search });
  // Shared with the account page, which can change the name - see lib/account.
  const user = useAccount();

  // The macOS title bar is a transparent overlay, so the traffic lights land on
  // the sidebar. Tell the stylesheet to leave them room - see `.wr-tauri`.
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in globalThis)
      document.documentElement.classList.add("wr-tauri");
  }, []);

  /**
   * Resolve who is signed in - and notice when nobody is.
   *
   * `beforeLoad` only proves a token *exists*; it cannot prove the server still
   * honours it. An expired or revoked one gets a 200 with a `null` body, and
   * treating that as a transient failure is what left the rail labelled
   * "Account" over a session where every other request was quietly 401ing.
   * A dead token is a signed-out user, so say so and send them to sign in.
   */
  useEffect(() => {
    let cancelled = false;

    const signedOut = () => {
      if (cancelled) return;
      setSessionToken(null);
      setAccount(null);
      void navigate({ to: "/signin", replace: true });
    };

    api
      .session()
      .then((s) => {
        if (cancelled) return;
        if (!s?.user) return signedOut();
        setAccount({
          // Null for anyone who signed up with an emailed code, and empty for
          // an account that existed before a provider was linked to it -
          // neither has ever told us a name. The email stands in.
          name: s.user.name ?? "",
          email: s.user.email,
          plan: s.user.plan,
          planSource: s.user.planSource,
          // Sent as an ISO string by Better Auth's session; every other
          // instant in the app is epoch ms, so it stops being a string here.
          planExpiresAt: s.user.planExpiresAt
            ? new Date(s.user.planExpiresAt).getTime()
            : null,
          timeZone: s.user.timeZone,
          avatarUrl: s.user.image ?? null,
          dayStartMinutes: s.user.dayStartMinutes,
          dayEndMinutes: s.user.dayEndMinutes,
          customRangeLabel: s.user.customRangeLabel ?? null,
          customRangeStartMinutes: s.user.customRangeStartMinutes ?? null,
          customRangeEndMinutes: s.user.customRangeEndMinutes ?? null,
          // A value the server does not recognise cannot reach here, but the
          // column is a string and this is the boundary where it stops being
          // one - a bad value would otherwise light up the wrong segment.
          dayOpensOn:
            s.user.dayOpensOn === "full" || s.user.dayOpensOn === "custom"
              ? s.user.dayOpensOn
              : "working",
          showOutsideRange: s.user.showOutsideRange,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401)
          return signedOut();
        // Anything else - offline, a 500 - is not proof of being signed out,
        // and must not throw someone out of an app they can still read.
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // No fallback: on a calendar scope nothing in this list is current, and
  // defaulting to one would light a row the user is not on.
  const active = NAV.find((item) => item.to === pathname)?.key ?? "";
  const today = todayOf();
  const scope = scopeOf(pathname);
  const period = periodLabel(scope, search as Record<string, unknown>, today);

  // The page in hand decides. Read off the deepest match rather than the whole
  // chain, so a layout route can never impose a rail on a child that did not
  // ask for one.
  const Rail = useRouterState({
    select: (state) => state.matches.at(-1)?.staticData?.rail,
  });

  /** Pages that want the whole width beside the sidebar - see `lib/rail`. */
  const fullWidth = useRouterState({
    select: (state) => state.matches.at(-1)?.staticData?.fullWidth === true,
  });

  // In the shell rather than on a page: a save started on Settings can fail
  // after the user has moved to Today, and the message has to survive that.
  const toasts = useToasts();

  return (
    <>
      <AppFrame
        chrome={false}
        // The same width of page whether or not this one has modules - unless
        // it has asked for the width instead, which the calendar's wider
        // scopes do.
        reserveRail={!fullWidth}
        {...(Rail ? { rail: <Rail /> } : {})}
        sidebar={
          <Sidebar
            items={NAV}
            active={active}
            scope={
              <ScopeSwitcher
                active={scope}
                dayLabel={dayLabel(today)}
                {...(period ? { periodLabel: period } : {})}
                onSelect={(key) => void navigate({ to: SCOPE_ROUTES[key] })}
              />
            }
            onNavigate={(key) => {
              const item = NAV.find((entry) => entry.key === key);
              // Destinations without a route yet do nothing rather than
              // navigating somewhere wrong. They are listed because they are the
              // real IA, not because they are built.
              if (item && "to" in item) void navigate({ to: item.to });
            }}
            user={
              <>
                <TrialPill />
                <UserMenu
                  // Name if the provider gave us one, address if not. `||` rather
                  // than `??` on purpose: an empty name is as absent as a null one,
                  // and rendering it would leave a nameless row and blank initials.
                  name={user?.name || user?.email || "Account"}
                  {...(user?.avatarUrl ? { avatarSrc: user.avatarUrl } : {})}
                  {...(user?.email !== undefined ? { email: user.email } : {})}
                  plan={user?.plan === "pro" ? "pro" : "free"}
                  items={USER_MENU}
                  onSelect={(key) => {
                    if (key === "signout") {
                      setAccount(null);
                      void api
                        .signOut()
                        .then(() => navigate({ to: "/signin" }));
                    } else if (key === "settings") {
                      void navigate({ to: "/settings" });
                    }
                  }}
                />
              </>
            }
          >
            <UpdateNotice />
          </Sidebar>
        }
      >
        <Outlet />
      </AppFrame>
      <SessionOverlay />
      <Toasts items={toasts} onDismiss={dismiss} />
    </>
  );
};

export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    if (!getSessionToken()) throw redirect({ to: "/signin" });
  },
  component: AppLayout,
});
