import type { CalendarEvent } from "@wiseroutine/scheduler";

export type ProviderId = "google" | "microsoft";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt: number;
  scope?: string | undefined;
  idToken?: string | undefined;
}

export interface ProviderCalendar {
  providerCalendarId: string;
  name: string;
  timeZone: string | null;
  isPrimary: boolean;
  accessRole: string | null;
}

/** A provider event mapped onto our vocabulary. Shares its enums with the
 *  scheduler so `isBusy()` can be applied without a second translation. */
export interface NormalisedEvent {
  providerEventId: string;
  icalUid: string | null;
  seriesMasterId: string | null;
  title: string | null;
  startsAt: number;
  endsAt: number;
  timeZone: string | null;
  isAllDay: boolean;
  kind: CalendarEvent["kind"];
  busyStatus: CalendarEvent["busyStatus"];
  responseStatus: CalendarEvent["responseStatus"];
  isCancelled: boolean;
  changeTag: string | null;
  providerUpdatedAt: number | null;
  /**
   * Where the meeting is held, when it is held anywhere - a Meet, Teams or
   * Zoom link off the event itself.
   *
   * Null rather than absent, because "this event has no video link" is an
   * answer the UI acts on: the block in the rail offers a Join button or it
   * does not, and an undefined would make that two states to write for.
   */
  joinUrl: string | null;
  /**
   * What the organiser wrote, as plain text.
   *
   * Kept because it is where half the useful detail about a meeting lives -
   * the agenda, the dial-in, the "bring the deck" - and because a great many
   * meetings put their join link in here and nowhere else: anything booked
   * through Calendly, HubSpot or a Zoom scheduler arrives with an empty
   * `conferenceData` and a body full of instructions.
   *
   * Plain text, not the provider's HTML. It is rendered inside the app's own
   * webview, so markup from a stranger's calendar invitation is not something
   * to hand to a DOM - and stripping it at the edge means every reader is safe
   * rather than each one having to remember.
   */
  description: string | null;
}

/**
 * The hosts a meeting link is allowed to be on.
 *
 * A description is full of URLs - map links, unsubscribe footers, the
 * organiser's website - so "the first link in the text" is the wrong answer
 * far more often than it is the right one. Naming the handful of things that
 * actually hold a meeting is duller and correct.
 */
const MEETING_HOSTS = [
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "zoom.us",
  "webex.com",
  "whereby.com",
  "meet.jit.si",
  "gotomeeting.com",
];

/** Every http(s) run in a blob of text or markup, cut at the delimiters a URL
 *  cannot contain: quotes, angle brackets and whitespace. */
const URLS = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * A meeting link hiding in an event's description.
 *
 * Read from the raw description rather than the stripped text, so a link that
 * only exists as an anchor's `href` - "click **here** to join" - is found too.
 */
export function meetingLinkIn(description: unknown): string | null {
  if (typeof description !== "string") return null;
  for (const match of description.match(URLS) ?? []) {
    // Trailing punctuation belongs to the sentence, not to the address.
    const candidate = joinableUrl(match.replace(/[.,;:]+$/, ""));
    if (!candidate) continue;
    const host = new URL(candidate).hostname;
    if (
      MEETING_HOSTS.some(
        (known) => host === known || host.endsWith(`.${known}`),
      )
    )
      return candidate;
  }
  return null;
}

/** How much of a description is worth keeping. Long enough for an agenda and
 *  a dial-in, short enough that a mail-thread-in-an-invite does not become the
 *  biggest thing in the database. */
const DESCRIPTION_MAX = 2_000;

/**
 * Provider HTML as text that keeps the shape of what was written.
 *
 * Not HTML, and not a plain flattening either. An invitation body is markup
 * written by someone outside this app, so handing it to a DOM is out of the
 * question - but flattening it loses the two things that make a long
 * description readable: which words are emphasised, and which ones are links.
 *
 * So it becomes a tiny known notation - `**bold**`, `_italic_`,
 * `[label](url)` - that the reader turns into React elements. Nothing is ever
 * parsed as markup again: the worst a hostile invitation can do here is show
 * its own asterisks.
 *
 * ponytail: a handful of replacements, not a parser. Anchors and emphasis are
 * converted before the remaining tags are dropped, because that is the only
 * ordering in which an `href` survives. A body that already contains `**` or
 * `[x](y)` will be read as formatting - which shows the wrong emphasis on a
 * line, and is the whole cost.
 */
export function toRichText(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;

  const inner = (html: string): string => html.replace(/<[^>]*>/g, "").trim();

  const text = value
    // Anchors first. The address lives inside the tag, so stripping tags is
    // what loses it - and a link is the most useful thing in a description.
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) => {
        const shown = inner(label);
        return shown && shown !== href ? `[${shown}](${href})` : href;
      },
    )
    .replace(
      /<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      (_match, _tag: string, body: string) => {
        const shown = inner(body);
        return shown ? `**${shown}**` : "";
      },
    )
    .replace(
      /<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      (_match, _tag: string, body: string) => {
        const shown = inner(body);
        return shown ? `_${shown}_` : "";
      },
    )
    // A list item is a line with a mark on it, which is all a list is once
    // there is nothing to indent it with.
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Three blank lines in a row is the invitation's formatting, not content.
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return text === "" ? null : text.slice(0, DESCRIPTION_MAX);
}

/**
 * A link we are willing to hand to the operating system, or nothing.
 *
 * Provider data reaches a button the user presses, and `openUrl` will open
 * whatever scheme it is allowed to - so the filter belongs here, at the edge
 * where the value arrives, rather than at each of the places that later show
 * it. `http`/`https` only: a meeting is on the web.
 */
export function joinableUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

export interface SyncPage {
  events: NormalisedEvent[];
  /** Graph tombstones, which carry only an id. */
  deletedIds: string[];
  /** More pages in this round. */
  nextPageToken?: string | undefined;
  /** Present only on the LAST page. Persist it or the next sync is a full one. */
  nextSyncToken?: string | undefined;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} API error ${status}: ${body.slice(0, 200)}`);
    this.name = "ProviderError";
  }

  /** 429 and 5xx are worth retrying; 4xx generally is not. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** The token is dead - surface "reconnect your calendar" rather than
   *  retrying a revoked grant a hundred times through the queue. */
  get needsReauth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Google 410 GONE, or Graph 410 / syncStateNotFound. Expected, not exceptional. */
export class SyncTokenExpired extends Error {
  constructor(readonly provider: ProviderId) {
    super(`${provider} sync token expired; a full resync is required`);
    this.name = "SyncTokenExpired";
  }
}

/** Extracted from an OIDC id_token without verification - we only ever read it
 *  from a response we just made over TLS to the provider's own token endpoint. */
export function decodeIdToken(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) return {};
  const normalised = payload.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(atob(normalised)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Map a normalised provider event onto the scheduler's `CalendarEvent`, whose
 *  `start`/`end` naming reflects that it is an interval, not a stored row. */
export function toCalendarEvent(
  event: NormalisedEvent,
  calendarId: string,
): CalendarEvent {
  return {
    id: event.providerEventId,
    calendarId,
    icalUid: event.icalUid ?? undefined,
    title: event.title ?? undefined,
    start: event.startsAt,
    end: event.endsAt,
    isAllDay: event.isAllDay,
    kind: event.kind,
    busyStatus: event.busyStatus,
    responseStatus: event.responseStatus,
    isCancelled: event.isCancelled,
  };
}
