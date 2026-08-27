import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { AppFrame, Sidebar, UserMenu } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { api, getSessionToken } from "../lib/api";

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
] as const;

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<{ email: string; plan: string } | null>(
    null,
  );

  // The sidebar names the account, so it needs the session it is already
  // guarded by. Failure is silent on purpose: a name that will not load must
  // not take the whole app down with it.
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((s) => {
        if (!cancelled) setUser({ email: s.user.email, plan: s.user.plan });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
              name={user?.email ?? "Account"}
              {...(user?.email !== undefined ? { email: user.email } : {})}
              plan={user?.plan === "pro" ? "pro" : "free"}
              onSelect={(key) => {
                if (key === "signout") {
                  void api.signOut().then(() => navigate({ to: "/signin" }));
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
