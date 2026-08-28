/**
 * Typed client for the Worker API.
 *
 * The desktop app holds only a session token - provider refresh tokens never
 * leave the server. Signing in is a code emailed to the user; connecting a
 * calendar is a separate step that completes in the system browser and returns
 * through the app's deep-link scheme.
 */

import {
  cachedPlan,
  cachePlan,
  clearOfflineState,
  enqueue,
  forget,
  type PendingKind,
  pending,
  withPending,
} from "./offline";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const TOKEN_KEY = "wiseroutine.session";

export function getSessionToken(): string | null {
  return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
}

/**
 * The zone this device believes it is in.
 *
 * `Intl` resolves it from the OS, so it follows the user across a flight
 * without anyone being asked. Falls back to UTC on the rare runtime that
 * cannot say - the same value the column already defaults to.
 */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function setSessionToken(token: string | null): void {
  if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
  else globalThis.localStorage?.removeItem(TOKEN_KEY);
}

/** No response at all, as opposed to a response we did not like. Only this
 *  means "queue it and try later"; a 4xx is the server's final answer. */
export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineError";
  }
}

/**
 * A provider sign-in that came back refused rather than unreachable.
 *
 * `reason` is Better Auth's own code, so the screen can answer the one case a
 * user can actually act on - `account_not_linked` - differently from a plain
 * "you pressed cancel".
 */
export class SocialSignInError extends Error {
  constructor(readonly reason: string) {
    super(`social sign-in refused: ${reason}`);
    this.name = "SocialSignInError";
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
    this.name = "ApiError";
  }

  /** A plan limit, with copy the UI can show verbatim. */
  get planLimit(): { reason: string; upsell: string } | undefined {
    if (this.status !== 402) return undefined;
    const body = this.body as { reason?: string; upsell?: string };
    return { reason: body.reason ?? "", upsell: body.upsell ?? "" };
  }
}

/**
 * Why the server said no, in whatever shape it said it.
 *
 * Plan limits answer with JSON; `HTTPException` answers with the message as
 * plain text. Reading only JSON quietly turned every one of those into `{}`,
 * so the server's own sentence - which is the only thing that says *which* of
 * two windows was inverted - never reached the screen, and every refusal
 * showed the same generic line.
 */
async function refusal(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return text ? { message: text } : {};
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch only rejects when the request never completed - no DNS, no route,
    // no server. That is the one case worth retrying later.
    throw new OfflineError();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await refusal(response));
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

/* ── Shapes the UI consumes ──────────────────────────────────────────────── */

export type SlotStatus =
  | "planned"
  | "live"
  | "started"
  | "completed"
  | "skipped"
  | "missed"
  | "cancelled";

export interface TodaySlot {
  id: string;
  title: string;
  kind: "recovery" | "focus" | "task";
  startsAt: number;
  endsAt: number;
  status: SlotStatus;
  isLocked: boolean;
  conflictEventId: string | null;
}

export interface TodayMeeting {
  id: string;
  title: string | null;
  startsAt: number;
  endsAt: number;
  isAllDay: boolean;
}

/** One of the day view's ranges, as the server derives them. */
export interface DayRange {
  key: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
}

export interface TodayResponse {
  date: { year: number; month: number; day: number };
  timeZone: string;
  dayStart: number;
  dayEnd: number;
  /** The range these bounds came from, which is not always the one asked for
   *  - a range deleted since falls back rather than failing. */
  range: string;
  ranges: DayRange[];
  slots: TodaySlot[];
  meetings: TodayMeeting[];
  /** Meetings the range does not cover, drawn as a line at each edge. Empty
   *  when the user has turned that off. */
  outside: { before: TodayMeeting[]; after: TodayMeeting[] };
  modules: string[];
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    /** Better Auth's `image`, mapped to `avatarUrl` in the database. Only ever
     *  rendered when it is an `https:` URL - see `Avatar`. */
    image?: string | null;
    timeZone: string;
    plan: "free" | "pro";
    planSource: string;
    /** The day view's hours, for the settings screen to edit. The Today page
     *  does not read these - it takes its ranges from `/today`, which already
     *  had to resolve them to answer at all. */
    dayStartMinutes: number;
    dayEndMinutes: number;
    customRangeLabel: string | null;
    customRangeStartMinutes: number | null;
    customRangeEndMinutes: number | null;
    dayOpensOn: string;
    showOutsideRange: boolean;
  };
}

/** Everything `PATCH /settings` accepts. The three custom-range fields move
 *  together - all set, or all null to clear it. */
export interface SettingsPatch {
  timeZone?: string;
  dayStartMinutes?: number;
  dayEndMinutes?: number;
  customRangeLabel?: string | null;
  customRangeStartMinutes?: number | null;
  customRangeEndMinutes?: number | null;
  dayOpensOn?: "working" | "full" | "custom";
  showOutsideRange?: boolean;
}

/** One provider that can sign this account in. Not a calendar connection. */
export interface LinkedAccountResponse {
  id: string;
  providerId: string;
  createdAt: string;
  scopes?: string[];
}

/** A provider account whose calendars we read. */
export interface CalendarConnection {
  id: string;
  provider: "google" | "microsoft";
  email: string;
  /** Anything other than "active" is a connection the user has to repair -
   *  a revoked token is silent otherwise, and the day just stops filling in. */
  status: string;
}

/** One calendar inside a connection, and whether we read it. */
export interface CalendarSummary {
  id: string;
  connectionId: string;
  name: string;
  isPrimary: boolean;
  isSelected: boolean;
  accessRole: string;
}

export interface CalendarsResponse {
  connections: CalendarConnection[];
  calendars: CalendarSummary[];
}

export interface MissedItem {
  id: string;
  title: string;
  status: string;
  dueAt: number;
  moveCount: number;
  reasonCode: string | null;
  reasonText: string | null;
}

/**
 * A slot action, taken now or remembered for later.
 *
 * The timestamp is attached here rather than on the server precisely because
 * it may travel: the server trusts it only inside a window (`replayedAt`), so
 * a routine followed on a plane keeps its real shape instead of collapsing
 * into the minute the connection came back.
 */
async function slotAction(
  slotId: string,
  kind: PendingKind,
  reason?: string,
): Promise<{ queued: boolean }> {
  const at = Date.now();
  const body = { at, ...(reason !== undefined ? { reason } : {}) };

  try {
    await send(`/slots/${slotId}/${kind}`, post(body));
    return { queued: false };
  } catch (error) {
    if (!(error instanceof OfflineError)) throw error;
    enqueue({ slotId, kind, at, ...(reason !== undefined ? { reason } : {}) });
    return { queued: true };
  }
}

/**
 * Send everything waiting, oldest first.
 *
 * Order matters: start-then-complete on one slot has to arrive that way round.
 * A rejected action is dropped rather than retried forever - the slot was
 * replanned or the day rolled over, and a queue that cannot drain is a queue
 * that blocks every later action behind it.
 */
export async function flushPending(): Promise<number> {
  const queue = pending();
  if (queue.length === 0) return 0;

  const done: string[] = [];

  for (const action of queue) {
    try {
      await send(
        `/slots/${action.slotId}/${action.kind}`,
        post({
          at: action.at,
          ...(action.reason !== undefined ? { reason: action.reason } : {}),
        }),
      );
      done.push(action.id);
    } catch (error) {
      if (error instanceof OfflineError) break;
      console.warn("dropping unsendable action", action.kind, action.slotId);
      done.push(action.id);
    }
  }

  forget(done);
  return done.length;
}

/**
 * Report this device's zone, once a session exists.
 *
 * Deliberately swallows its own failure: a wrong time zone is worth fixing but
 * is never a reason to fail a sign-in that has already succeeded. The Account
 * page can set it explicitly, and the next sign-in tries again.
 */
async function announceTimeZone(): Promise<void> {
  try {
    await api.setTimeZone(deviceTimeZone());
  } catch {
    // Not worth surfacing - the user is signed in either way.
  }
}

export const api = {
  /** Ask for a sign-in code. Also the sign-*up* path: an address that can read
   *  its own mail is the whole registration. */
  sendCode: (email: string) =>
    request<void>(
      "/auth/email-otp/send-verification-otp",
      post({ email, type: "sign-in" }),
    ),

  /** Exchange the code for a session. Better Auth returns the token in a
   *  header rather than the body, because the browser flow uses a cookie. */
  async signIn(email: string, otp: string): Promise<void> {
    const response = await send(
      "/auth/sign-in/email-otp",
      post({ email, otp }),
    );
    const token = response.headers.get("set-auth-token");
    if (!token) throw new ApiError(500, { error: "no_session_token" });
    clearOfflineState();
    setSessionToken(token);
    await announceTimeZone();
  },

  /**
   * Begin a provider sign-in. Returns the consent URL and the ticket to
   * redeem once the user has been through it.
   *
   * Deliberately does *not* open the browser itself. Opening can fail - a
   * popup blocker, a webview with no opener - and the caller is the only one
   * that can react to that: polling for a consent that was never shown is the
   * bug this split exists to prevent.
   *
   * Which calendars the account syncs is a separate question entirely - see
   * `connectUrl`. Signing in with Google connects nothing.
   */
  startSocial: (provider: "google" | "microsoft") =>
    request<{ url: string; ticket: string }>(
      "/signin/social/start",
      post({ provider }),
    ),

  /**
   * Wait for consent to land, then hold the session it produced.
   *
   * The session is created in a browser this process cannot read, so the
   * server parks the token against the ticket and this collects it. What comes
   * back is the same kind of token an emailed code produces, which is why
   * nothing downstream needs to know how the user signed in.
   */
  async awaitSocial(ticket: string, signal?: AbortSignal): Promise<void> {
    // The ticket outlives any sensible wait; this loop is bounded by it rather
    // than by a count of its own, so the two can never disagree about when an
    // attempt is over.
    for (;;) {
      // Aborting matters: without it, walking back to the email form leaves a
      // poll running that would sign the user in minutes later, out of
      // nowhere.
      if (signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (signal?.aborted) return;

      const result = await request<
        | { status: "pending" }
        | { status: "ready"; token: string }
        | { status: "failed"; reason: string }
        | { status: "expired" }
      >("/signin/social/claim", post({ ticket }));

      if (result.status === "pending") continue;
      if (result.status === "ready") {
        clearOfflineState();
        setSessionToken(result.token);
        await announceTimeZone();
        return;
      }
      throw new SocialSignInError(
        result.status === "failed" ? result.reason : "expired",
      );
    }
  },

  /**
   * The providers that can sign this account in.
   *
   * Better Auth's own endpoint - there is no route of ours in front of it,
   * because there is nothing of ours to add. Note what these are *not*:
   * calendar connections, which live in the user's own database and are listed
   * by `/calendars`.
   */
  listAccounts: () => request<LinkedAccountResponse[]>("/auth/list-accounts"),

  /** The one profile field the user owns. Everything else on the user row is
   *  `input: false` server-side and cannot be written from here. */
  updateName: (name: string) =>
    request<unknown>("/auth/update-user", post({ name })),

  /** Remove one way of signing in. The emailed code always remains, which is
   *  what makes removing the last provider safe. */
  unlinkAccount: (accountId: string) =>
    request<unknown>("/auth/unlink-account", post({ accountId })),

  async signOut(): Promise<void> {
    await send("/auth/sign-out", post({})).catch(() => undefined);
    setSessionToken(null);
    // Whose "today" this is has changed; a leftover plan or queued action
    // would belong to the previous account.
    clearOfflineState();
  },

  /**
   * The current session, or `null`.
   *
   * Better Auth answers 200 with a literal `null` body for a token it does not
   * recognise - expired, revoked, or issued by a database that has since been
   * reset. That is not an error, so it must not be typed as one: a caller that
   * assumes a user here reads `.user` off null and throws somewhere far away
   * from the cause.
   */
  session: () => request<SessionResponse | null>("/auth/get-session"),

  /** Mint a consent URL for the signed-in account. Authenticated, so which
   *  account the calendar attaches to is never a query parameter. */
  connectUrl: (provider: "google" | "microsoft") =>
    request<{ url: string }>(`/connect/${provider}/start`, post({})).then(
      (r) => r.url,
    ),

  /**
   * Today's plan, from the server if it can be reached and from the last
   * saved copy if it cannot.
   *
   * `stale` is what the view needs to be honest about what it is showing -
   * an old plan presented as current is worse than an error.
   */
  async today(
    options: { at?: number; range?: string } = {},
  ): Promise<TodayResponse & { stale: boolean; cachedAt: number }> {
    const now = Date.now();
    const query = new URLSearchParams();
    if (options.at) query.set("at", String(options.at));
    if (options.range) query.set("range", options.range);
    const suffix = query.size > 0 ? `?${query}` : "";

    try {
      const data = await request<TodayResponse>(`/today${suffix}`);
      cachePlan(data, now);
      return { ...withPending(data, pending()), stale: false, cachedAt: now };
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;

      const saved = cachedPlan(now);
      // Nothing saved, or saved for a day that has ended: there is no honest
      // plan to show, so this is a plain failure.
      if (!saved) throw error;

      return {
        ...withPending(saved.data, pending()),
        stale: true,
        cachedAt: saved.cachedAt,
      };
    }
  },
  /**
   * Tell the server which zone this device is in.
   *
   * Every preferred window is evaluated in this zone, so the default of "UTC"
   * quietly shifts someone's whole day. Sent once at sign-in rather than on
   * every load, so that a zone the user later chooses by hand is not
   * overwritten every time they open the app.
   */
  setTimeZone: (timeZone: string) => api.updateSettings({ timeZone }),

  /** Everything else on the settings page. One route, because the server
   *  validates the day's window against the row as it will be - see
   *  `PATCH /settings`. */
  updateSettings: (patch: SettingsPatch) =>
    request<void>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /** Every connected account and the calendars under it, selected or not. */
  calendars: () => request<CalendarsResponse>("/calendars"),

  /** Read this calendar, or stop. The server schedules or cancels the sync
   *  behind the response, so this returns as soon as the choice is recorded. */
  selectCalendar: (id: string, isSelected: boolean) =>
    request<void>(`/calendars/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isSelected }),
    }),

  /** Forget an account: its calendars, its events and its token. Unlike
   *  deselecting, there is no way back from this except fresh consent. */
  disconnect: (connectionId: string) =>
    request<void>(`/connections/${connectionId}`, { method: "DELETE" }),

  /** Ask for a sync now rather than at the next tick - the refresh button. */
  sync: () => request<{ ok: true }>("/sync", post({})),

  missed: () => request<MissedItem[]>("/missed"),
  plan: (trigger = "user_request") =>
    request<{ planRunId: string; placed: number; unplaced: unknown[] }>(
      "/plan",
      {
        method: "POST",
        body: JSON.stringify({ trigger }),
      },
    ),
  startSlot: (id: string) => slotAction(id, "start"),
  completeSlot: (id: string) => slotAction(id, "complete"),
  skipSlot: (id: string, reason?: string) => slotAction(id, "skip", reason),
  pendingCount: () => pending().length,
};

/** Merge slots and meetings into one ordered timeline, which is what screen 3a
 *  actually renders. The live slot is the one happening now. */
export interface TimelineRow {
  key: string;
  startsAt: number;
  endsAt: number;
  variant: "focus" | "recovery" | "live" | "meeting";
  title: string;
  meta?: string;
  done?: boolean;
  slotId?: string;
}

export function buildTimeline(data: TodayResponse, now: number): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const slot of data.slots) {
    if (slot.status === "cancelled") continue;
    const isLive =
      slot.startsAt <= now && now < slot.endsAt && slot.status !== "completed";

    rows.push({
      key: slot.id,
      slotId: slot.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      variant: isLive ? "live" : slot.kind === "focus" ? "focus" : "recovery",
      title: slot.title,
      meta: `${Math.round((slot.endsAt - slot.startsAt) / 60_000)} min`,
      done: slot.status === "completed",
    });
  }

  for (const meeting of data.meetings) {
    if (meeting.isAllDay) continue;
    rows.push({
      key: meeting.id,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      variant: "meeting",
      // A null title means the user opted out of storing titles, or we only
      // have free/busy access on that calendar.
      title: meeting.title ?? "Busy",
      meta: `${Math.round((meeting.endsAt - meeting.startsAt) / 60_000)} min`,
    });
  }

  return rows.sort((a, b) => a.startsAt - b.startsAt);
}
