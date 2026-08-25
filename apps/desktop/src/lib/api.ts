/**
 * Typed client for the Worker API.
 *
 * The desktop app holds only a session token — provider refresh tokens never
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
    // fetch only rejects when the request never completed — no DNS, no route,
    // no server. That is the one case worth retrying later.
    throw new OfflineError();
  }

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
 * A rejected action is dropped rather than retried forever — the slot was
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
  },

  async signOut(): Promise<void> {
    await send("/auth/sign-out", post({})).catch(() => undefined);
    setSessionToken(null);
    // Whose "today" this is has changed; a leftover plan or queued action
    // would belong to the previous account.
    clearOfflineState();
  },

  session: () => request<SessionResponse>("/auth/get-session"),

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
   * `stale` is what the view needs to be honest about what it is showing —
   * an old plan presented as current is worse than an error.
   */
  async today(
    at?: number,
  ): Promise<TodayResponse & { stale: boolean; cachedAt: number }> {
    const now = Date.now();
    try {
      const data = await request<TodayResponse>(
        `/today${at ? `?at=${at}` : ""}`,
      );
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
