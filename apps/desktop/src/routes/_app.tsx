import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { AppFrame, Sidebar, UserMenu } from "@wiseroutine/design";
import { useEffect } from "react";
import { setAccount, useAccount } from "../lib/account";
import { ApiError, api, getSessionToken, setSessionToken } from "../lib/api";

/**
 * The app shell every signed-in page renders inside.
 *
 * A pathless layout route, so a new page is a file rather than a file plus a
 * remembered wrapper — the chrome cannot drift between screens because there
 * is only one copy of it.
 *
 * Sign-in lives outside this route. Guarding here rather than in each page
 * means one place decides who gets in, and no page has to render a half-shell
 * for a session it does not have.
 */

/** The product's navigation, whether or not each destination exists yet. */
const NAV = [
  { key: "today", label: "Today", to: "/" },
  { key: "week", label: "Week" },
  { key: "activities", label: "Activities" },
  { key: "reminders", label: "Reminders" },
  { key: "calendars", label: "Calendars" },
  { key: "account", label: "Account", to: "/account" },
] as const;

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Shared with the account page, which can change the name — see lib/account.
  const user = useAccount();

  /**
   * Resolve who is signed in — and notice when nobody is.
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
          // an account that existed before a provider was linked to it —
          // neither has ever told us a name. The email stands in.
          name: s.user.name ?? "",
          email: s.user.email,
          plan: s.user.plan,
          timeZone: s.user.timeZone,
          avatarUrl: s.user.image ?? null,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) return signedOut();
        // Anything else — offline, a 500 — is not proof of being signed out,
        // and must not throw someone out of an app they can still read.
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const active =
    NAV.find((item) => "to" in item && item.to === pathname)?.key ?? "today";

  return (
    <AppFrame
      chrome={false}
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
              onSelect={(key) => {
                if (key === "signout") {
                  setAccount(null);
                  void api.signOut().then(() => navigate({ to: "/signin" }));
                } else if (key === "account") {
                  void navigate({ to: "/account" });
                }
              }}
            />
          }
        />
      }
    >
      <Outlet />
    </AppFrame>
  );
};

export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    if (!getSessionToken()) throw redirect({ to: "/signin" });
  },
  component: AppLayout,
});
