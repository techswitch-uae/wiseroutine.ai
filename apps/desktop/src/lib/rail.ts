import type React from "react";

/**
 * Which pages carry the right-hand module rail, and what goes in it.
 *
 * The shell used to render the rail for every signed-in page, which meant the
 * set-up module followed the user onto Calendars and Account — where it is
 * noise at best, and at worst is asking them to connect a calendar on the page
 * they are already connecting one from.
 *
 * A page's own file is the right place to know this, so the answer lives on
 * the route rather than in a list the shell keeps. Declaring nothing means no
 * rail, which is the correct default: a page has to ask for the furniture.
 *
 *   export const Route = createFileRoute("/_app/")({
 *     component: Today,
 *     staticData: { rail: SetupRail },
 *   });
 *
 * Typed through TanStack's own `staticData`, so a misspelling is a build
 * error rather than a rail that silently never appears.
 */
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Rendered into the rail. Omit for a page that does not want one. */
    rail?: React.ComponentType;
  }
}
