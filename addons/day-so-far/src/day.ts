import type { DaySlot } from "@wiseroutine/addon-sdk";

/**
 * The day, read against the clock.
 *
 * Lifted wholesale from the first-party card this addon replaces, and it
 * changed in exactly one way: it reads `DaySlot` - the narrowed view the host
 * hands across the port - rather than the app's own `TodaySlot`. Nothing it
 * counted needed a field an addon may not see, which is the useful thing this
 * move proved. If it had, the honest conclusion would have been that the read
 * scope was too narrow, not that the card had to stay first-party.
 *
 * Pure, and separate from `main.ts`, for the reason every addon in this repo
 * splits the same way: `main.ts` needs a port and a document, and none of the
 * rules below need either.
 */

/** Not dealt with yet. Whether one of these is still ahead of you is a
 *  question about the clock, not about the status - see `tallyOf`. */
const PENDING = new Set(["planned", "live", "started"]);

export interface DayTally {
  done: number;
  skipped: number;
  missed: number;
  /** Pending, and still ahead of the clock. */
  ahead: number;
  /** Pending, but its window has closed. Not yours to do anything about, and
   *  never counted as time still to come. */
  overdue: number;
  /** Minutes of completed blocks, and minutes of the ones still ahead. */
  doneMinutes: number;
  aheadMinutes: number;
  /** When the last block still ahead finishes, or null when none is. */
  endsAt: number | null;
}

/**
 * The day, bucketed against the clock.
 *
 * A slot the server has not resolved yet is not automatically "to go": one
 * whose window closed while nobody was looking is in the past, and counting
 * its minutes as time still ahead of you makes the rest of the day look longer
 * than it is. `started` is the exception - a block you are in the middle of is
 * allowed to run past its own end.
 *
 * Cancelled slots are left out entirely - a block that was taken off the day
 * was never something the day failed to do.
 */
export function tallyOf(slots: readonly DaySlot[], now: number): DayTally {
  const t: DayTally = {
    done: 0,
    skipped: 0,
    missed: 0,
    ahead: 0,
    overdue: 0,
    doneMinutes: 0,
    aheadMinutes: 0,
    endsAt: null,
  };

  for (const slot of slots) {
    const minutes = Math.round((slot.endsAt - slot.startsAt) / 60_000);
    if (slot.status === "cancelled") continue;
    if (slot.status === "completed") {
      t.done++;
      t.doneMinutes += minutes;
    } else if (PENDING.has(slot.status)) {
      if (slot.endsAt > now || slot.status === "started") {
        t.ahead++;
        t.aheadMinutes += minutes;
        t.endsAt = Math.max(t.endsAt ?? 0, slot.endsAt);
      } else t.overdue++;
    } else if (slot.status === "skipped") t.skipped++;
    else t.missed++;
  }
  return t;
}

/** Everything the day has to account for. Zero means a day this card knows
 *  nothing about, which is not the same as a day where nothing happened. */
export const totalOf = (t: DayTally): number =>
  t.done + t.skipped + t.missed + t.ahead + t.overdue;

/** Over, not merely quiet: a block whose window closed unresolved is still
 *  something the day is waiting on, so it is not a day that is done. */
export const settledOf = (t: DayTally): boolean =>
  t.ahead === 0 && t.overdue === 0;

/** "45 m", "2 h", "2 h 10". The same reading the app's minimums use, so two
 *  cards in one rail do not write the same duration two ways. */
export function spanOf(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h${minutes % 60 ? ` ${minutes % 60}` : ""}`;
}

/**
 * The clock, in the user's own zone.
 *
 * The zone comes from `DayView` rather than from the frame, and it has to: an
 * addon's iframe resolves `Intl` against the machine, and someone whose
 * schedule is in Lisbon while their laptop is in Berlin would be told their
 * last block runs through an hour that is not on their day.
 */
export function clockOf(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(at));
  } catch {
    // An unknown zone name. Better a time in the wrong zone than a card that
    // throws where it says what is left.
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  }
}

/** The heading: what the day amounts to, in one line. */
export const headlineOf = (t: DayTally): string => {
  const total = totalOf(t);
  return settledOf(t) && t.done === total
    ? "Everything you planned happened"
    : `${t.done} of ${total} done`;
};

/**
 * The quiet line under the bar - what lapsed, and what is left.
 *
 * Skipped, missed and overdue are named apart, because they are not the same
 * admission: one you made, one happened to you, and one is still waiting for
 * the server to decide. Neither is scolded and none is hidden - a day where
 * two things did not happen should say so in the same card that says four did.
 */
export function footnoteOf(t: DayTally, timeZone: string): string {
  const lapsed = [
    t.skipped > 0 ? `${t.skipped} skipped` : null,
    t.missed > 0 ? `${t.missed} missed` : null,
    t.overdue > 0 ? `${t.overdue} overdue` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const left =
    t.ahead > 0 && t.endsAt !== null
      ? `${t.ahead === 1 ? "One more" : `${t.ahead} more`}, through ${clockOf(t.endsAt, timeZone)}`
      : "";

  return [lapsed, left].filter(Boolean).join(". ");
}
