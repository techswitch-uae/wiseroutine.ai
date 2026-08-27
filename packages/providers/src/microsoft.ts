import type {
  NormalisedEvent,
  OAuthTokens,
  ProviderCalendar,
  SyncPage,
} from "./types";
import { ProviderError, SyncTokenExpired } from "./types";

/**
 * Microsoft Graph, over plain `fetch`.
 *
 * The Graph SDK works on Workers, but `@azure/identity` does not — it assumes
 * `node:net`/`node:tls`. Since we need exactly one token grant and one delta
 * endpoint, hand-rolled fetch is both smaller and clearer.
 */

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const API = "https://graph.microsoft.com/v1.0";

/**
 * `Calendars.ReadBasic` returns the subject but **excludes body and
 * attachments** — everything the free/busy engine needs and nothing more,
 * which is a materially better privacy story than `Calendars.Read`.
 *
 * `offline_access` is what produces a refresh token. Omitting it is the single
 * most common oversight in a Graph integration.
 */
export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Calendars.ReadBasic",
] as const;

export function microsoftAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`${AUTHORITY}/authorize`);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  // Without this, a browser with a live Entra session is signed straight
  // through on that account — so "connect another calendar" reconnects the one
  // already connected, and a second Microsoft account cannot be added at all.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<OAuthTokens> {
  const response = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new ProviderError("microsoft", response.status, JSON.stringify(json));
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scope: json.scope ? String(json.scope) : undefined,
    idToken: json.id_token ? String(json.id_token) : undefined,
  };
}

export function microsoftExchangeCode(params: {
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
    scope: MICROSOFT_SCOPES.join(" "),
  });
}

export function microsoftRefresh(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthTokens> {
  return tokenRequest({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES.join(" "),
  });
}

async function api(
  url: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      // Without this, times come back in UTC — which is what we want, so we
      // deliberately do NOT send Prefer: outlook.timezone.
      "content-type": "application/json",
    },
  });

  // Two different signals mean the same thing: start over from a full sync.
  // Delta tokens live in a bounded cache, so there is no guaranteed TTL.
  if (response.status === 410) throw new SyncTokenExpired("microsoft");
  if (!response.ok) {
    const text = await response.text();
    if (text.includes("syncStateNotFound"))
      throw new SyncTokenExpired("microsoft");
    throw new ProviderError("microsoft", response.status, text);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function microsoftListCalendars(
  accessToken: string,
): Promise<ProviderCalendar[]> {
  const json = await api(`${API}/me/calendars`, accessToken);
  const items = (json.value ?? []) as Record<string, unknown>[];
  return items.map((item) => ({
    providerCalendarId: String(item.id),
    name: String(item.name ?? "Calendar"),
    timeZone: null,
    isPrimary: item.isDefaultCalendar === true,
    accessRole: item.canEdit === true ? "writer" : "reader",
  }));
}

function mapShowAs(raw: unknown): NormalisedEvent["busyStatus"] {
  switch (raw) {
    case "free":
      return "free";
    case "tentative":
      return "tentative";
    case "oof":
    case "workingElsewhere":
      return "oof";
    default:
      return "busy";
  }
}

function mapResponse(raw: unknown): NormalisedEvent["responseStatus"] {
  const response = (raw as Record<string, unknown> | undefined)?.response;
  switch (response) {
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    case "accepted":
    case "organizer":
      return "accepted";
    default:
      return "none";
  }
}

/**
 * Graph returns `{ dateTime, timeZone }` where **`dateTime` carries no offset**
 * and the zone is a separate field. Parsing `dateTime` as an ISO instant
 * without applying `timeZone` is the single most common Graph calendar bug, so
 * the zone is appended explicitly here.
 */
function parseGraphTime(value: unknown): number {
  const slot = (value ?? {}) as Record<string, unknown>;
  const raw = String(slot.dateTime ?? "");
  const zone = String(slot.timeZone ?? "UTC");
  if (!raw) return Number.NaN;

  // We never send Prefer: outlook.timezone, so Graph answers in UTC.
  if (zone === "UTC" || zone === "Etc/UTC") {
    return Date.parse(raw.endsWith("Z") ? raw : `${raw}Z`);
  }

  // Defensive: resolve a named zone by measuring its offset at that wall time.
  const naive = Date.parse(`${raw}Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(naive));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return naive - (asUtc - naive);
}

export function normaliseMicrosoftEvent(
  raw: Record<string, unknown>,
): NormalisedEvent {
  return {
    providerEventId: String(raw.id),
    icalUid: raw.iCalUId ? String(raw.iCalUId) : null,
    seriesMasterId: raw.seriesMasterId ? String(raw.seriesMasterId) : null,
    title: raw.subject ? String(raw.subject) : null,
    startsAt: parseGraphTime(raw.start),
    endsAt: parseGraphTime(raw.end),
    timeZone: raw.originalStartTimeZone
      ? String(raw.originalStartTimeZone)
      : null,
    isAllDay: raw.isAllDay === true,
    // Graph has no eventType equivalent; showAs carries the whole signal.
    kind: "default",
    busyStatus: mapShowAs(raw.showAs),
    responseStatus: mapResponse(raw.responseStatus),
    isCancelled: raw.isCancelled === true,
    changeTag: raw.changeKey ? String(raw.changeKey) : null,
    providerUpdatedAt: raw.lastModifiedDateTime
      ? Date.parse(String(raw.lastModifiedDateTime))
      : null,
  };
}

export interface MicrosoftSyncParams {
  accessToken: string;
  calendarId: string;
  /** A full deltaLink or nextLink URL, used verbatim. */
  link?: string | undefined;
  /** Only for the initial call; the window is then frozen inside the token. */
  startDateTime?: string;
  endDateTime?: string;
}

/**
 * One page of the delta loop.
 *
 * `/calendarView/delta` expands occurrences and exceptions for us, which is the
 * Graph equivalent of Google's `singleEvents=true` — its recurrence model is
 * proprietary, not RFC 5545, so writing our own expander would be a bug farm.
 *
 * The window is encoded into the token, so as real time advances the far edge
 * creeps closer. Callers must periodically re-baseline with a fresh full delta.
 */
export async function microsoftSyncPage(
  params: MicrosoftSyncParams,
): Promise<SyncPage> {
  let url: string;
  if (params.link) {
    url = params.link;
  } else {
    const built = new URL(
      `${API}/me/calendars/${encodeURIComponent(params.calendarId)}/calendarView/delta`,
    );
    if (params.startDateTime)
      built.searchParams.set("startDateTime", params.startDateTime);
    if (params.endDateTime)
      built.searchParams.set("endDateTime", params.endDateTime);
    url = built.toString();
  }

  const json = await api(url, params.accessToken);
  const items = (json.value ?? []) as Record<string, unknown>[];

  const events: NormalisedEvent[] = [];
  const deletedIds: string[] = [];

  for (const item of items) {
    // A Graph tombstone carries ONLY the id — no other fields — so the delete
    // path must work from that alone.
    if (item["@removed"]) {
      deletedIds.push(String(item.id));
      continue;
    }
    events.push(normaliseMicrosoftEvent(item));
  }

  return {
    events,
    deletedIds,
    nextPageToken: json["@odata.nextLink"]
      ? String(json["@odata.nextLink"])
      : undefined,
    nextSyncToken: json["@odata.deltaLink"]
      ? String(json["@odata.deltaLink"])
      : undefined,
  };
}

/**
 * Create a change-notification subscription.
 *
 * Outlook `event` subscriptions last 10,080 minutes (just under 7 days) — a
 * figure widely cited wrong. Renew at 50-70% of that. `lifecycleNotificationUrl`
 * is effectively mandatory: its `missed` event is the only signal that Graph
 * dropped changes, and `reauthorizationRequired` is how a subscription avoids
 * dying silently when the token expires before it does.
 */
export async function microsoftSubscribe(params: {
  accessToken: string;
  calendarId: string;
  notificationUrl: string;
  lifecycleNotificationUrl: string;
  clientState: string;
  expiresAt: number;
}): Promise<{ subscriptionId: string; expiresAt: number }> {
  const response = await fetch(`${API}/subscriptions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      changeType: "created,updated,deleted",
      notificationUrl: params.notificationUrl,
      lifecycleNotificationUrl: params.lifecycleNotificationUrl,
      resource: `me/calendars/${params.calendarId}/events`,
      expirationDateTime: new Date(params.expiresAt).toISOString(),
      clientState: params.clientState,
    }),
  });

  if (!response.ok)
    throw new ProviderError(
      "microsoft",
      response.status,
      await response.text(),
    );
  const json = (await response.json()) as Record<string, unknown>;
  return {
    subscriptionId: String(json.id),
    expiresAt: Date.parse(String(json.expirationDateTime)),
  };
}

export async function microsoftRenewSubscription(params: {
  accessToken: string;
  subscriptionId: string;
  expiresAt: number;
}): Promise<void> {
  await fetch(`${API}/subscriptions/${params.subscriptionId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      expirationDateTime: new Date(params.expiresAt).toISOString(),
    }),
  });
}

/**
 * The admin-consent URL.
 *
 * Many work tenants disable user consent entirely, so an employee cannot grant
 * even a low-privilege delegated permission — they get AADSTS65001 or
 * AADSTS90094 and, without this, a dead end. Sending them this link turns a
 * hard no into a slow yes.
 */
export function microsoftAdminConsentUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** The user's tenant if we know it; otherwise Entra resolves it at sign-in. */
  tenant?: string | undefined;
}): string {
  const url = new URL(
    `https://login.microsoftonline.com/${params.tenant ?? "common"}/adminconsent`,
  );
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/** Entra error codes that mean "an administrator has to approve this app". */
export function needsAdminConsent(errorDescription: string): boolean {
  return /AADSTS65001|AADSTS90094|AADSTS900941/.test(errorDescription);
}
