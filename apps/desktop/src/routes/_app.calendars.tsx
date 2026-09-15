import { createFileRoute, redirect } from "@tanstack/react-router";
import { CALENDARS_ANCHOR } from "../lib/settings-sections";

/** Keep old bookmarks working; calendar configuration now belongs to Settings. */
export const Route = createFileRoute("/_app/calendars")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", hash: CALENDARS_ANCHOR, replace: true });
  },
});
