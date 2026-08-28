import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  AppFrame,
  Sidebar,
  Toasts,
  UpdatePill,
  UserMenu,
} from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { setAccount, useAccount } from "../lib/account";
import { ApiError, api, getSessionToken, setSessionToken } from "../lib/api";
import { dismiss, useToasts } from "../lib/notify";
import "../lib/rail";
import { type AppUpdate, checkForUpdate, installUpdate } from "../lib/updates";

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
 * The navigation, which is every page that exists.
 *
 * Week, Activities, Reminders and Calendars were listed here as the intended
 * information architecture. They had no routes, so each was a dead click - the
 * rail offered five destinations and reached two. The design kit still carries
 * them as the plan; this list is the product.
 */
const NAV = [
  { key: "today", label: "Today", to: "/" },
  { key: "calendars", label: "Calendars", to: "/calendars" },
  { key: "settings", label: "Settings", to: "/settings" },
] as const;

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

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Shared with the account page, which can change the name - see lib/account.
  const user = useAccount();

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

  const active =
    NAV.find((item) => "to" in item && item.to === pathname)?.key ?? "today";

  // The page in hand decides. Read off the deepest match rather than the whole
  // chain, so a layout route can never impose a rail on a child that did not
  // ask for one.
  const Rail = useRouterState({
    select: (state) => state.matches.at(-1)?.staticData?.rail,
  });

  // In the shell rather than on a page: a save started on Settings can fail
  // after the user has moved to Today, and the message has to survive that.
  const toasts = useToasts();

  return (
    <>
      <AppFrame
        chrome={false}
        // Always the same width of page, whether or not this one has modules.
        reserveRail
        {...(Rail ? { rail: <Rail /> } : {})}
        sidebar={
          <Sidebar
            items={NAV}
            active={active}
            onNavigate={(key) => {
              const item = NAV.find((entry) => entry.key === key);
              // Destinations without a route yet do nothing rather than
              // navigating somewhere wrong. They are listed because they are the
              // real IA, not because they are built.
              if (item && "to" in item) void navigate({ to: item.to });
            }}
            user={
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
                    void api.signOut().then(() => navigate({ to: "/signin" }));
                  } else if (key === "settings") {
                    void navigate({ to: "/settings" });
                  }
                }}
              />
            }
          >
            <UpdateNotice />
          </Sidebar>
        }
      >
        <Outlet />
      </AppFrame>
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
