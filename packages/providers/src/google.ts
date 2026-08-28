import type {
  NormalisedEvent,
  OAuthTokens,
  ProviderCalendar,
  SyncPage,
} from "./types";
import { ProviderError, SyncTokenExpired } from "./types";

/**
 * Google Calendar, over plain `fetch`.
 *
 * Deliberately not the `googleapis` package: it is a monolith containing every
 * Google API surface and would fight the Worker bundle-size limit and the
 * one-second startup budget. The whole surface we need is three endpoints.
 */

const OAUTH = "https://oauth2.googleapis.com/token";
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const API = "https://www.googleapis.com/calendar/v3";

/**
 * Read-only scopes.
 *
 * `calendar.events.readonly` gives event bodies (needed for the overlap UI);
 * `calendar.calendarlist.readonly` allows multi-calendar discovery. Neither is
 * a *restricted* scope, so no CASA security assessment applies - but declare
 * the full 12-month set up front, since adding one later forces re-verification.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export function googleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  // Without these two there is no refresh token on repeat consent, which is
  // the classic "it worked once and never again" bug.
  url.searchParams.set("access_type", "offline");
  // `select_account` as well as `consent`: connecting a *second* calendar is
  // the normal case - work and personal - and with only `consent` a browser
  // signed into one account re-consents that same account and silently
  // re-upserts the connection the user already had.
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<OAuthTokens> {
  const response = await fetch(OAUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new ProviderError("google", response.status, JSON.stringify(json));
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scope: json.scope ? String(json.scope) : undefined,
    idToken: json.id_token ? String(json.id_token) : undefined,
  };
}

export function googleExchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OAuthTokens> {
  return tokenRequest({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
}

export function googleRefresh(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthTokens> {
  return tokenRequest({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });
}

async function api(
  path: string,
  accessToken: string,
  query: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  // 410 GONE means the sync token is dead - an ACL change on the calendar can
  // cause it. It is an expected code path, not an error.
  if (response.status === 410) throw new SyncTokenExpired("google");
  if (!response.ok) {
    throw new ProviderError("google", response.status, await response.text());
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function googleListCalendars(
  accessToken: string,
): Promise<ProviderCalendar[]> {
  const json = await api("/users/me/calendarList", accessToken, {
    maxResults: "250",
  });
  const items = (json.items ?? []) as Record<string, unknown>[];
  return items.map((item) => ({
    providerCalendarId: String(item.id),
    name: String(item.summary ?? item.id),
    timeZone: item.timeZone ? String(item.timeZone) : null,
    isPrimary: item.primary === true,
    accessRole: item.accessRole ? String(item.accessRole) : null,
  }));
}

/** Google's `eventType`, mapped onto our vocabulary. Anything unrecognised is
 *  "default", which is the safe direction: it stays busy. */
function mapKind(raw: unknown): NormalisedEvent["kind"] {
  switch (raw) {
    case "workingLocation":
      return "workingLocation";
    case "birthday":
      return "birthday";
    case "fromGmail":
      return "fromGmail";
    case "outOfOffice":
      return "outOfOffice";
    case "focusTime":
      return "focusTime";
    default:
      return "default";
  }
}

function mapResponse(
  event: Record<string, unknown>,
): NormalisedEvent["responseStatus"] {
  const attendees = (event.attendees ?? []) as Record<string, unknown>[];
  const self = attendees.find((a) => a.self === true);
  switch (self?.responseStatus) {
    case "declined":
      return "declined";
    case "tentative":
      return "tentative";
    case "accepted":
      return "accepted";
    default:
      return "none";
  }
}

function parseTime(value: unknown): {
  at: number;
  isAllDay: boolean;
  timeZone: string | null;
} {
  const slot = (value ?? {}) as Record<string, unknown>;
  if (slot.date) {
    // All-day events are floating - a calendar date, not an instant. Parsed as
    // UTC midnight and flagged, so downstream never treats it as a real time.
    return {
      at: Date.parse(`${String(slot.date)}T00:00:00Z`),
      isAllDay: true,
      timeZone: null,
    };
  }
  return {
    at: Date.parse(String(slot.dateTime)),
    isAllDay: false,
    timeZone: slot.timeZone ? String(slot.timeZone) : null,
  };
}

export function normaliseGoogleEvent(
  raw: Record<string, unknown>,
): NormalisedEvent {
  const start = parseTime(raw.start);
  const end = parseTime(raw.end);

  return {
    providerEventId: String(raw.id),
    icalUid: raw.iCalUID ? String(raw.iCalUID) : null,
    seriesMasterId: raw.recurringEventId ? String(raw.recurringEventId) : null,
    title: raw.summary ? String(raw.summary) : null,
    startsAt: start.at,
    endsAt: end.at,
    timeZone: start.timeZone,
    isAllDay: start.isAllDay,
    kind: mapKind(raw.eventType),
    busyStatus: raw.transparency === "transparent" ? "free" : "busy",
    responseStatus: mapResponse(raw),
    isCancelled: raw.status === "cancelled",
    changeTag: raw.etag ? String(raw.etag) : null,
    providerUpdatedAt: raw.updated ? Date.parse(String(raw.updated)) : null,
  };
}

export interface GoogleSyncParams {
  accessToken: string;
  calendarId: string;
  /** Absent on a full sync. */
  syncToken?: string | undefined;
  /** Only used on a full sync; baked into the token from then on. */
  timeMin?: string;
  timeMax?: string;
  pageToken?: string | undefined;
}

/**
 * One page of the sync loop.
 *
 * Two rules the API enforces that shape the caller:
 *  - `nextSyncToken` appears **only on the last page**, so bailing out of
 *    pagination early means no token and a forced full resync next time. Page
 *    inside a queue consumer, never in a request handler.
 *  - a sync token cannot be combined with `timeMin`/`timeMax` - the window used
 *    on the initial full sync is baked into the token forever. Changing it
 *    means starting over.
 */
export async function googleSyncPage(
  params: GoogleSyncParams,
): Promise<SyncPage> {
  const query: Record<string, string> = {
    singleEvents: "true", // let Google expand recurrence; ours would be a bug farm
    maxResults: "250",
    showDeleted: "true", // cancellations are our tombstones
  };

  if (params.syncToken) {
    query.syncToken = params.syncToken;
  } else {
    if (params.timeMin) query.timeMin = params.timeMin;
    if (params.timeMax) query.timeMax = params.timeMax;
  }
  if (params.pageToken) query.pageToken = params.pageToken;

  const json = await api(
    `/calendars/${encodeURIComponent(params.calendarId)}/events`,
    params.accessToken,
    query,
  );

  const items = (json.items ?? []) as Record<string, unknown>[];
  return {
    events: items.map(normaliseGoogleEvent),
    deletedIds: [],
    nextPageToken: json.nextPageToken ? String(json.nextPageToken) : undefined,
    nextSyncToken: json.nextSyncToken ? String(json.nextSyncToken) : undefined,
  };
}

/**
 * Open a push channel.
 *
 * There is no renewal API: renewing means calling this again with a fresh UUID
 * and stopping the old channel, which leaves an overlap window where both
 * deliver. The webhook must be idempotent.
 */
export async function googleWatch(params: {
  accessToken: string;
  calendarId: string;
  channelId: string;
  address: string;
  /** Echoed back as X-Goog-Channel-Token - our only authentication on the
   *  webhook. Google's docs are explicit that it must not hold a real token. */
  token: string;
  ttlSeconds?: number;
}): Promise<{ resourceId: string; expiration: number }> {
  const response = await fetch(
    `${API}/calendars/${encodeURIComponent(params.calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: params.channelId,
        type: "web_hook",
        address: params.address,
        token: params.token,
        params: { ttl: String(params.ttlSeconds ?? 604_800) },
      }),
    },
  );

  if (!response.ok)
    throw new ProviderError("google", response.status, await response.text());
  const json = (await response.json()) as Record<string, unknown>;
  return {
    resourceId: String(json.resourceId),
    expiration: Number(json.expiration ?? Date.now() + 604_800_000),
  };
}

export async function googleStopChannel(params: {
  accessToken: string;
  channelId: string;
  resourceId: string;
}): Promise<void> {
  await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: params.channelId,
      resourceId: params.resourceId,
    }),
  });
}
