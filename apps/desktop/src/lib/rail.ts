import type React from "react";

/**
 * Which pages carry the right-hand module rail, and what goes in it.
 *
 * The shell used to render the rail for every signed-in page, which meant the
 * set-up module followed the user onto Calendars and Account - where it is
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
    /**
     * Give the page the whole width beside the sidebar, rail column included.
     *
     * Not the same statement as declaring no rail. Every page without modules
     * still *reserves* the column, so that a form is the same width on
     * Settings as on Calendars and moving between them does not reflow the
     * window - see `reserveRail`. This is the other case: a page whose content
     * is a full-width surface and has nothing to gain from a 250px column of
     * kept-clear space. The week, month and year grids are that - they are
     * measured in days across, and every pixel taken off the right is a
     * narrower Thursday.
     *
     * A page that wants both a rail and this is a contradiction; `rail` wins,
     * because a module that has been asked for has to go somewhere.
     */
    fullWidth?: boolean;
  }
}
