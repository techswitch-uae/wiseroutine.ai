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
