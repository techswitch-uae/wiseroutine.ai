/**
 * The Wise Routine addon SDK.
 *
 * This file is the whole surface an addon has. Your code runs in an iframe
 * with `sandbox="allow-scripts"`: an opaque origin, no storage, no reach into
 * the app, and a Content-Security-Policy built from what the user granted.
 * The host hands you one `MessagePort` at load, and everything below travels
 * over it.
 *
 * Inside the frame:
 *
 * - `localStorage`, `sessionStorage` and `indexedDB` throw. Use `store`.
 * - `fetch` reaches only the `net:fetch` origins you were granted, and sends
 *   `Origin: null`. For an API that needs a key, use `wr.fetch` instead: the
 *   host signs the request and the key never reaches your code.
 * - The host paints the ground behind your frame. Set `html, body {
 *   background: transparent }` and use `wr.theme` for colours.
 *
 * Every call is async, even the ones that look like they need not be.
 *
 * ```ts
 * import { connect } from "@wiseroutine/addon-sdk";
 *
 * const wr = await connect();
 * if (wr.role.kind === "widget") drawCard(wr);
 * else if (wr.role.kind === "session") runSession(wr);
 * ```
 *
 * See `addons/` in the Wise Routine repository for complete examples. The
 * app's own sessions and cards are written against exactly this SDK.
 */

/* ── What the host sends ────────────────────────────────────────────────── */

/**
 * The slot your session runs in. Instants are epoch milliseconds.
 *
 * `endsAt` is when this run ends, which may differ from where the block sits
 * on the day. Pace against it.
 */
export interface SessionSlot {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number;
}

/** Your session. `config` is the activity's settings, parsed against the
 *  schema in your manifest. */
export interface Session<Config = unknown> {
  slot: SessionSlot;
  config: Config;
}

/**
 * The host's colours and fonts, resolved to values. Your frame inherits
 * nothing, so hard-coding a colour means being unreadable in one theme.
 *
 * On a `dim` ground the host paints near-black and light text is right in
 * either theme, so a session drawn on it may ignore these.
 */
export interface AddonTheme {
  text: string;
  muted: string;
  background: string;
  hairline: string;
  track: string;
  accent: string;
  fontBody: string;
  fontHeading: string;
}

/** One slot on the user's day. `ownedByYou` is true for slots you placed;
 *  only those can be changed by you. */
export interface DaySlot {
  id: string;
  title: string;
  kind: "recovery" | "focus" | "task";
  startsAt: number;
  endsAt: number;
  status:
    | "planned"
    | "live"
    | "started"
    | "completed"
    | "skipped"
    | "missed"
    | "cancelled";
  ownedByYou: boolean;
}

export interface DayView {
  dayStart: number;
  dayEnd: number;
  timeZone: string;
  slots: DaySlot[];
}

/** A todo: something with no time yet. Once placed it becomes a slot. */
export interface Todo {
  id: string;
  title: string;
  minutes: number | null;
  needsFocus: boolean;
  /** The first gap on today that fits it, or null. Computed by the host. */
  fitsAt: number | null;
}

/** What the user typed into Quick add and handed to you. `key` is the bare
 *  key from your manifest's `quickAdd`. */
export interface QuickAddRequest {
  key: string;
  title: string;
  minutes: number | null;
}

/** Answers a Quick add request. A returned string is shown to the user. */
export type QuickAddListener = (request: QuickAddRequest) => unknown;

/* ── Why you were loaded ────────────────────────────────────────────────── */

/**
 * One bundle serves every role. The host tells you which one this frame is
 * in the handshake, so branch on it first.
 *
 * - `session`: a guided session is running. Call `session()`.
 * - `widget`: a card in the rail. Call `card()` when you have something to show.
 * - `background`: a hidden frame kept running while the app is open. Given to
 *   addons with `quickAdd` rows or `background:wake`. Quick add requests are
 *   delivered here when this frame exists.
 */
export type AddonRole =
  | { kind: "session" }
  | { kind: "widget"; widgetKey: string }
  | { kind: "background" };

/**
 * How the host frames your card. The card is hidden until the first call.
 * Pass `null` to take it down.
 */
export interface WidgetCard {
  /** The small label at the top of the card. Defaults to the widget's name. */
  eyebrow?: string;
  /** CSS pixels, clamped by the host to `CARD_BOUNDS`. */
  height?: number;
}

/* ── Errors ─────────────────────────────────────────────────────────────── */

/**
 * The host refused. `denied` is a rule: a missing grant, a slot you do not
 * own. `failed` is something that went wrong. The message is written to be
 * shown to the user.
 */
export class AddonError extends Error {
  constructor(
    message: string,
    readonly kind: "denied" | "failed" = "denied",
  ) {
    super(message);
    this.name = "AddonError";
  }
}

/* ── The client ─────────────────────────────────────────────────────────── */

export interface AddonClient {
  readonly role: AddonRole;
  readonly theme: AddonTheme;
  /** The SDK contract the host speaks. Compare with your manifest's
   *  `apiVersion`. */
  readonly hostVersion: number;

  /** The session you were loaded for. Rejects unless `role.kind` is
   *  `"session"`. */
  session<Config = unknown>(): Promise<Session<Config>>;

  /** End the session early as done. The host completes the slot, the same
   *  as the user pressing Done. Requires `ui:session`. */
  finishSession(): Promise<void>;

  /** Show or update your card, or `card(null)` to hide it. Widgets only. */
  card(card: WidgetCard | null): Promise<void>;

  /** Your addon-level settings, as the user set them on the Addons page.
   *  Secret fields are never included. */
  settings<T = Record<string, unknown>>(): Promise<T>;

  /** Fires when the day changed. Carries nothing: call `day()` again. */
  onDayChange(listener: () => void): () => void;

  /** The user's day. Requires `read:schedule`. */
  day(): Promise<DayView>;

  /**
   * Place a slot of your own. Give `startsAt` to pin it there, or
   * `preferredAt` and the host picks the first that is free, falling back to
   * the first free gap today. Requires `write:own`.
   */
  placeSlot(request: {
    title: string;
    kind: "recovery" | "focus" | "task";
    minutes: number;
    startsAt?: number;
    preferredAt?: number[];
  }): Promise<DaySlot>;

  /** Complete or skip a slot you placed. The server refuses any other.
   *  Requires `write:own`. */
  setSlotStatus(slotId: string, status: "completed" | "skipped"): Promise<void>;

  /**
   * Fetch through the host. Same signature as `fetch`, restricted to your
   * `net:fetch` origins. Use it when the origin needs a key: if the
   * capability declares `auth`, the host adds the header from the secret the
   * user entered. Also avoids `Origin: null`. Only string bodies. Desktop app
   * only; in the web build it is refused.
   */
  fetch(input: string, init?: RequestInit): Promise<Response>;

  /** Open an https link on one of your `open:external` origins in the
   *  user's browser. Resolves false if the machine refused. */
  openExternal(url: string): Promise<boolean>;

  /** Show the user a notification, labelled with your addon's name.
   *  Requires `notify`. */
  notify(notice: { title: string; body?: string }): Promise<void>;

  /**
   * A small key-value store, private to your addon, on this device. Values
   * must be JSON, up to 16 KB each. Cleared when the addon is removed.
   */
  store: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };

  /** The user's todos. `list` needs `read:todos`; the rest need
   *  `write:todos`. `place` refuses when nothing today fits. */
  todos: {
    list(): Promise<Todo[]>;
    add(input: { title: string; minutes?: number | null }): Promise<Todo>;
    set(id: string, status: "done" | "dropped"): Promise<void>;
    place(id: string, startsAt?: number): Promise<DaySlot>;
  };

  onTodosChange(listener: () => void): () => void;

  /**
   * Quick add handed you something. Do the work in the listener; when it
   * settles the host tells the user. Return a short sentence to show, or
   * throw to report a failure. Delivered to your `background` frame if you
   * have one, otherwise to your first running frame.
   */
  onQuickAdd(listener: QuickAddListener): () => void;
}

/* ── The wire ───────────────────────────────────────────────────────────── */

interface RpcCall {
  id: number;
  method: string;
  params?: unknown;
}

/** Not named `Response`: that shadows the DOM class this module returns. */
interface RpcReply {
  id: number;
  result?: unknown;
  error?: { message: string; kind: "denied" | "failed" };
}

/** Something the host announces. Told apart from a reply by having no `id`. */
type HostEvent =
  | { event: "day" }
  | { event: "todos" }
  | { event: "quickAdd"; requestId: number; request: QuickAddRequest };

const HANDSHAKE = "wiseroutine:addon:port";

interface Handshake {
  type: typeof HANDSHAKE;
  role: AddonRole;
  theme: AddonTheme;
  hostVersion?: number;
}

const isHandshake = (data: unknown): data is Handshake =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === HANDSHAKE;

/**
 * Connect to the host. Call once at the top of your entry point.
 *
 * The timeout matters: an addon waiting for a port that never comes is a
 * blank session with no explanation.
 */
export function connect(timeoutMs = 10_000): Promise<AddonClient> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      globalThis.removeEventListener("message", onMessage);
      reject(new AddonError("The host never sent a port.", "failed"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      // The handshake is the only message accepted on the window. Everything
      // after travels on the port.
      if (!isHandshake(event.data)) return;
      const port = event.ports[0];
      if (!port) return;

      clearTimeout(timer);
      globalThis.removeEventListener("message", onMessage);
      resolve(clientOver(port, event.data));
    }

    globalThis.addEventListener("message", onMessage);
  });
}

function clientOver(port: MessagePort, hello: Handshake): AddonClient {
  let nextId = 1;
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const onDay = new Set<() => void>();
  const onTodos = new Set<() => void>();
  const onQuick = new Set<QuickAddListener>();

  const answerQuickAdd = async (
    requestId: number,
    request: QuickAddRequest,
  ) => {
    try {
      let message: string | undefined;
      for (const listen of [...onQuick]) {
        const said = await listen(request);
        if (typeof said === "string") message = said;
      }
      port.postMessage({
        event: "quickAdd:done",
        requestId,
        ...(message ? { message: message.slice(0, 80) } : {}),
      });
    } catch (cause) {
      port.postMessage({
        event: "quickAdd:done",
        requestId,
        error: cause instanceof Error ? cause.message : "It did not work.",
      });
    }
  };

  port.addEventListener(
    "message",
    (event: MessageEvent<RpcReply | HostEvent>) => {
      const data = event.data;
      if (!data) return;

      if (!("id" in data)) {
        // Copied before iterating: a listener may unsubscribe itself.
        if (data.event === "day") for (const listen of [...onDay]) listen();
        if (data.event === "todos") for (const listen of [...onTodos]) listen();
        if (data.event === "quickAdd") {
          void answerQuickAdd(data.requestId, data.request);
        }
        return;
      }

      const { id, result, error } = data;
      const pending = waiting.get(id);
      if (!pending) return;
      waiting.delete(id);
      if (error) pending.reject(new AddonError(error.message, error.kind));
      else pending.resolve(result);
    },
  );
  port.start();

  const call = <T>(method: string, params?: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      const call: RpcCall = { id, method, ...(params ? { params } : {}) };
      port.postMessage(call);
    });

  const listen =
    <L>(set: Set<L>) =>
    (listener: L) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };

  return {
    role: hello.role,
    theme: hello.theme,
    hostVersion: hello.hostVersion ?? 1,
    session: <Config>() => call<Session<Config>>("session"),
    finishSession: () => call<void>("finishSession"),
    card: (card) => call<void>("card", { card }),
    settings: <T>() => call<T>("settings"),
    onDayChange: listen(onDay),
    day: () => call<DayView>("day"),
    placeSlot: (request) => call<DaySlot>("placeSlot", request),
    setSlotStatus: (slotId, status) =>
      call<void>("setSlotStatus", { slotId, status }),
    fetch: async (input: string, init?: RequestInit) => {
      const reply = await call<{
        status: number;
        headers: [string, string][];
        body: string;
      }>("fetch", {
        input,
        method: init?.method ?? "GET",
        // Only what survives a structured clone. A `Headers` instance would
        // not cross, and a stream cannot be replayed by the host.
        headers: plainHeaders(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(reply.body, {
        status: reply.status,
        headers: reply.headers,
      });
    },
    openExternal: (url) => call<boolean>("openExternal", { url }),
    notify: (notice) => call<void>("notify", notice),
    store: {
      get: (key) => call<unknown>("store.get", { key }),
      set: (key, value) => call<void>("store.set", { key, value }),
    },
    todos: {
      list: () => call<Todo[]>("todos.list"),
      add: (input) => call<Todo>("todos.add", input),
      set: (id, status) => call<void>("todos.set", { id, status }),
      place: (id, startsAt) =>
        call<DaySlot>("todos.place", {
          id,
          ...(startsAt !== undefined ? { startsAt } : {}),
        }),
    },
    onTodosChange: listen(onTodos),
    onQuickAdd: listen(onQuick),
  };
}

/** `HeadersInit` in any of its three shapes, as a plain record. */
function plainHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    Object.assign(out, headers);
  }
  return out;
}
