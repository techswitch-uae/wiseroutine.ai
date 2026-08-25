/**
 * Typed client for the Worker API.
 *
 * The desktop app holds only a session token — provider refresh tokens never
 * leave the server. Signing in is a code emailed to the user; connecting a
 * calendar is a separate step that completes in the system browser and returns
 * through the app's deep-link scheme.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const TOKEN_KEY = "wiseroutine.session";

export function getSessionToken(): string | null {
  return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
}

export function setSessionToken(token: string | null): void {
  if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
  else globalThis.localStorage?.removeItem(TOKEN_KEY);
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

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body);
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

export interface TodayResponse {
  date: { year: number; month: number; day: number };
  timeZone: string;
  dayStart: number;
  dayEnd: number;
  slots: TodaySlot[];
  meetings: TodayMeeting[];
  modules: string[];
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    timeZone: string;
    plan: "free" | "pro";
    planSource: string;
  };
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
    setSessionToken(token);
  },

  async signOut(): Promise<void> {
    await send("/auth/sign-out", post({})).catch(() => undefined);
    setSessionToken(null);
  },

  session: () => request<SessionResponse>("/auth/get-session"),

  /** Mint a consent URL for the signed-in account. Authenticated, so which
   *  account the calendar attaches to is never a query parameter. */
  connectUrl: (provider: "google" | "microsoft") =>
    request<{ url: string }>(`/connect/${provider}/start`, post({})).then(
      (r) => r.url,
    ),

  today: (at?: number) =>
    request<TodayResponse>(`/today${at ? `?at=${at}` : ""}`),
  missed: () => request<MissedItem[]>("/missed"),
  plan: (trigger = "user_request") =>
    request<{ planRunId: string; placed: number; unplaced: unknown[] }>(
      "/plan",
      {
        method: "POST",
        body: JSON.stringify({ trigger }),
      },
    ),
  startSlot: (id: string) =>
    request<void>(`/slots/${id}/start`, { method: "POST" }),
  completeSlot: (id: string) =>
    request<void>(`/slots/${id}/complete`, { method: "POST" }),
  skipSlot: (id: string) =>
    request<void>(`/slots/${id}/skip`, { method: "POST" }),
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
