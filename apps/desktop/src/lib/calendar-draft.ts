/**
 * The unsaved ticks on the Calendars page.
 *
 * Its own module because the rule is not obvious and is easy to break by
 * accident: only one account may have unsaved changes at a time. Two accounts
 * each showing an Update button looks like two independent edits, but saving
 * one reloads from the server and silently throws the other away - so starting
 * on a second account puts the first one back rather than leaving that trap
 * open.
 */

/** Only what the rule needs: an id and what the server last said about it. */
export interface DraftCalendar {
  id: string;
  connectionId: string;
  isSelected: boolean;
}

export type Draft = Record<string, boolean>;

/** The ticks as the server last described them. */
export function draftFrom(calendars: readonly DraftCalendar[]): Draft {
  return Object.fromEntries(calendars.map((cal) => [cal.id, cal.isSelected]));
}

/** Which of an account's calendars are not as the server left them. */
export function changedIn(
  draft: Draft,
  calendars: readonly DraftCalendar[],
  connectionId: string,
): DraftCalendar[] {
  return calendars.filter(
    (cal) =>
      cal.connectionId === connectionId && draft[cal.id] !== cal.isSelected,
  );
}

/**
 * Tick one calendar.
 *
 * `editing` is the account whose unsaved ticks are currently on screen. When
 * the tick lands on a different account, everything resets to the server state
 * first, so the other account's Update and Cancel disappear instead of sitting
 * there about to be discarded.
 */
export function applyTick(
  draft: Draft,
  calendars: readonly DraftCalendar[],
  editing: string | null,
  connectionId: string,
  id: string,
  isSelected: boolean,
): Draft {
  const base =
    editing !== null && editing !== connectionId ? draftFrom(calendars) : draft;
  return { ...base, [id]: isSelected };
}

/** Put one account's ticks back without touching anyone else's. */
export function revertIn(
  draft: Draft,
  calendars: readonly DraftCalendar[],
  connectionId: string,
): Draft {
  return {
    ...draft,
    ...draftFrom(calendars.filter((cal) => cal.connectionId === connectionId)),
  };
}
