/**
 * The Wise Routine addon SDK.
 *
 * This is the whole surface an addon has. If something is not on this page,
 * an addon cannot do it - not because it is discouraged, but because the code
 * runs in a sandboxed frame with no same-origin access, no Tauri IPC and no
 * network beyond the origins its manifest declared. There is no back door to
 * find, which is the point: it means an addon can be installed by someone who
 * has not read it.
 *
 * ## How an addon runs
 *
 * The host loads your bundle into an `<iframe sandbox="allow-scripts">` and
 * hands it one `MessagePort`. Everything below travels over that port. The
 * frame has an opaque origin, so:
 *
 * - `localStorage`, `sessionStorage` and `indexedDB` throw. Ask the host.
 * - `window.parent` is unreachable except through the port you were given.
 * - `fetch` reaches only the origins in your manifest's `net:fetch`, and that
 *   is enforced by the frame's Content-Security-Policy as well as by a check.
 * - The host paints the ground behind your frame, so set `html, body {
 *   background: transparent }`. `color-scheme` alone is not enough: the
 *   browser paints its own canvas, and it will not be the same dark as the
 *   host's.
 *
 * Possession of the port *is* the capability. It is transferred once, at load,
 * and never broadcast - so nothing else on the page can talk to the host as
 * you, and you cannot talk to another addon.
 *
 * ## Everything is async
 *
 * Every call returns a promise, including the ones that look like they could
 * be synchronous. That is not incidental: the host may be in another frame,
 * and an API that was synchronous today could not move there tomorrow without
 * rewriting every addon that used it.
 *
 * ## Writing one
 *
 * ```ts
 * import { connect } from "@wiseroutine/addon-sdk";
 *
 * const wr = await connect();
 * const session = await wr.session();
 * document.body.append(render(session.config));
 * ```
 *
 * See `addons/breathing` in the Wise Routine repository for a complete,
 * working example - it is the app's own breathing pacer, written against
 * exactly this SDK and with no privileges yours does not have.
 */

/* ── What the host sends ─────────────────────────────────────────────────── */

/**
 * The slot your session is running in.
 *
 * Instants in epoch milliseconds, like everything else that crosses this
 * boundary. Deliberately not `Date`: an addon and the host may disagree about
 * a timezone, and they may not disagree about an instant.
 *
 * `endsAt` is when *this run* ends, which is not always where the block sits
 * on the day - a three-minute session begun six minutes early ends three
 * minutes later, not nine. Pace against this, not against the calendar.
 */
export interface SessionSlot {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number;
}

/**
 * Your session, as the host is running it.
 *
 * `config` is whatever your settings schema produced, already parsed by the
 * host against the schema in your manifest. It is yours - the host stores it
 * as opaque JSON and does not look inside beyond validating it against the
 * schema you declared.
 */
export interface Session<Config = unknown> {
  slot: SessionSlot;
  config: Config;
}

/**
 * The host's look, as values rather than as variables.
 *
 * Your frame is a separate document with an opaque origin, so it inherits
 * nothing: not the app's stylesheet, not its CSS custom properties, not its
 * `prefers-color-scheme` handling. Hard-coding a colour means an addon that is
 * legible in one theme and unreadable in the other, and the user picked the
 * theme.
 *
 * So the host resolves its own tokens and sends them. They are already
 * computed - `#1a1a19`, not `var(--color-text)` - because a variable would
 * only be a name for something your document has no definition of.
 *
 * Whether you should use them depends on the `ground` your activity type
 * declared. On `page` you are drawing inside the app's own surface and should
 * use these. On `dim` the host paints a near-black ground of its own, and
 * light text on it is the right answer whatever the theme is - which is why
 * the breathing pacer hard-codes its two colours and is right to.
 */
export interface AddonTheme {
  /** Body text on the current ground. */
  text: string;
  /** Secondary text - captions, hints, the quieter half of a pair. */
  muted: string;
  /** The surface behind your frame. Yours should stay transparent; this is
   *  for anything you need to draw *over* it opaquely. */
  background: string;
  /** The one-pixel rule the app draws between things. */
  hairline: string;
  /** The empty half of a progress bar. Distinct from `hairline`, which is a
   *  border: a track is a filled shape and needs to read as one. */
  track: string;
  /** The app's own accent. Use sparingly - it is the colour the user's eye
   *  has learned means "this is the app talking". */
  accent: string;
  fontBody: string;
  fontHeading: string;
}

/**
 * One slot on the user's day.
 *
 * A narrower view than the app's own: no conflict data, no lock state, no
 * calendar event ids. An addon is shown what it needs to draw and to reason
 * about its own work, and `ownedByYou` is the one that matters for writes -
 * a slot where that is false cannot be changed by you, and the server will
 * refuse it however the request is phrased.
 */
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

/** The day, as far as your `read:schedule` scope reaches. */
export interface DayView {
  /** Local midnight and the end of the user's day, as instants. */
  dayStart: number;
  dayEnd: number;
  timeZone: string;
  slots: DaySlot[];
}

/* ── Why you were loaded ─────────────────────────────────────────────────── */

/**
 * What the host loaded you to be.
 *
 * An addon may contribute a guided session, a card in the rail, or both, and
 * the same bundle runs in every case - one addon is one bundle, served from
 * one `addon://` document. So the role has to arrive from outside, and it
 * arrives in the handshake rather than as a call: it is known before your
 * first line runs, and a round trip to ask "what am I?" would be a round trip
 * every addon pays before it can draw anything.
 *
 * Branch on it at the top of your entry point:
 *
 * ```ts
 * const wr = await connect();
 * if (wr.role.kind === "widget") return drawCard(wr);
 * return runSession(wr);
 * ```
 */
export type AddonRole =
  | { kind: "session" }
  /** `widgetKey` is the bare key from your manifest's `widgets`, not the
   *  namespaced one - inside your own bundle there is nothing to namespace
   *  against. It tells an addon contributing two cards which one this is. */
  | { kind: "widget"; widgetKey: string };

/**
 * How the host should frame your card.
 *
 * The rail card around your frame is the host's - its ground, its corner
 * radius, its spacing, the same as every other card beside it. You draw the
 * inside. What you get to say about the outside is this, and it exists
 * because three things genuinely cannot be decided from a manifest:
 *
 * - **Whether there is anything to show at all.** A card that says nothing
 *   is worse than no card: an empty surface in the rail reads as something
 *   that failed to load. Pass `null` to `card()` and the host takes it down.
 * - **The eyebrow**, which is often a reading of the data rather than a name
 *   for the addon - "Day so far" against "Day done".
 * - **How tall you are.** An iframe has no intrinsic height, so something
 *   has to say, and only you know how many lines you drew.
 *
 * Your card starts hidden and appears when you first call `card()`. That way
 * round on purpose: a card that appeared and then vanished a tick later,
 * because the addon had nothing after all, is a flicker in the corner of the
 * user's eye every time the rail renders.
 */
export interface WidgetCard {
  /** The small upper-case label at the top of the card. Falls back to the
   *  name your manifest gave this widget. */
  eyebrow?: string;
  /** CSS pixels, clamped by the host - see `CARD_BOUNDS` in
   *  `@wiseroutine/addons`. You cannot grow until you have pushed the rest of
   *  the rail off the screen. */
  height?: number;
}

/* ── Errors ──────────────────────────────────────────────────────────────── */

/**
 * The host refused.
 *
 * Always because of a rule, never because of a bug: a capability you were not
 * granted, a slot you do not own, a scope wider than your manifest asked for.
 * The message is the reason, written to be shown to the user if that helps
 * them - it is the same sentence the permission screen would use.
 */
export class AddonError extends Error {
  constructor(
    message: string,
    /** `denied` is a rule. `failed` is something that went wrong. */
    readonly kind: "denied" | "failed" = "denied",
  ) {
    super(message);
    this.name = "AddonError";
  }
}

/* ── The client ──────────────────────────────────────────────────────────── */

export interface AddonClient {
  /**
   * Why the host loaded you. Known at connect, so it is a value, not a call.
   */
  readonly role: AddonRole;

  /**
   * The app's own colours and fonts, resolved. See `AddonTheme`.
   *
   * Handed over with the port rather than fetched, so there is no first paint
   * in the wrong colours - a flash of unreadable text at the start of a
   * session is worse than no theming at all.
   */
  readonly theme: AddonTheme;

  /**
   * The session you were loaded for.
   *
   * Rejects if `role.kind` is not `"session"`. Check the role rather than
   * catching this: it is a programming mistake, not a condition.
   */
  session<Config = unknown>(): Promise<Session<Config>>;

  /**
   * Show your card in the rail, or take it down.
   *
   * Only for `role.kind === "widget"`; rejects otherwise. Call it as often as
   * your reading changes - it is a plain state update on the host side, not a
   * remount, so your frame keeps running and nothing reloads.
   *
   * `card(null)` hides you. Until the first call you are not on screen at all.
   */
  card(card: WidgetCard | null): Promise<void>;

  /**
   * Be told when the user's day changes, instead of asking on a timer.
   *
   * Fires when a slot is completed, skipped, moved, or the day is re-read -
   * whatever the reason, the answer `day()` would give is no longer the one
   * you drew. It carries nothing: call `day()` for the new one.
   *
   * A rail card has to be current, and polling is the wrong shape for that.
   * Every addon on a timer is a wakeup the machine pays for whether or not
   * anything happened, and the lag between pressing Done and the card
   * agreeing is the interval you picked.
   *
   * Returns the unsubscribe. You rarely need it - your frame is torn down
   * with your card - but a listener you cannot remove is not a listener.
   */
  onDayChange(listener: () => void): () => void;

  /**
   * The user's day, as far as your granted scope reaches.
   *
   * Rejects with `AddonError` if you were not granted `read:schedule`, or
   * asked for a wider window than you were granted.
   */
  day(): Promise<DayView>;

  /**
   * Ask for a slot of your own.
   *
   * Two ways, and the first is usually right. Give `preferredAt` and the app's
   * scheduler places it in a real gap alongside everything else the user has,
   * so it cannot land on a meeting or double-book another addon. Give
   * `startsAt` and it goes exactly there, pinned, which is what you want only
   * when the time is the point - a class that starts at six.
   *
   * The slot is yours: `ownedByYou` will be true, and you may change it.
   * Requires `write:own`.
   */
  placeSlot(request: {
    title: string;
    kind: "recovery" | "focus" | "task";
    minutes: number;
    /** Exact placement, pinned. Mutually exclusive with `preferredAt`. */
    startsAt?: number;
    /** Instants you would prefer, best first. The scheduler decides. */
    preferredAt?: number[];
  }): Promise<DaySlot>;

  /**
   * Complete or skip a slot you own.
   *
   * Refused for a slot you do not own, by the server and not merely here.
   * Requires `write:own`.
   */
  setSlotStatus(slotId: string, status: "completed" | "skipped"): Promise<void>;

  /**
   * Fetch, restricted to the origins your manifest declared.
   *
   * The same signature as `fetch`, and for a declared origin you may simply
   * use `fetch` instead - the frame's CSP already permits it and nothing here
   * is doing you a favour. This exists for the case where the host has a
   * credential you do not: an integration whose token the user connected
   * through the app never has that token handed to your code.
   */
  fetch(input: string, init?: RequestInit): Promise<Response>;

  /**
   * Open a link outside the app, in whatever the machine uses for it.
   *
   * Requires `open:external`, and the URL's origin must be one your manifest
   * declared - the host re-checks it rather than trusting the grant alone, so
   * a redirect you did not write cannot be laundered through this.
   *
   * Resolves `true` if the machine took it. `false` means it refused - an
   * unregistered scheme, a browser that is not there - and is worth telling
   * the user about, because a link that silently does nothing reads as a
   * broken addon.
   *
   * Use it sparingly. Sending someone out of the app in the middle of a
   * session is the most disruptive thing an addon can do, and it is exactly
   * what a session is meant to prevent.
   */
  openExternal(url: string): Promise<boolean>;

  /**
   * Store something small, private to your addon and this user.
   *
   * The sandboxed frame has no storage of its own by design. This is the
   * replacement: a few kilobytes, yours alone, and gone when the user
   * uninstalls you.
   */
  store: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
}

/* ── The wire ────────────────────────────────────────────────────────────── */

/**
 * One call, and its answer.
 *
 * Deliberately boring: a monotonic id, a method name and a JSON payload.
 * Everything is structured-cloneable, so nothing needs a serialiser and
 * nothing can smuggle a function across.
 */
interface RpcCall {
  id: number;
  method: string;
  params?: unknown;
}

/**
 * Named `RpcReply` rather than `Response`, which is not a style preference.
 * `Response` shadows the DOM class inside this module, and the first version
 * of this file did exactly that - so `fetch(): Promise<Response>` on the
 * public interface silently promised this envelope instead of an HTTP
 * response. Published types are a contract; one that compiles and means the
 * wrong thing is worse than one that does not compile.
 */
interface RpcReply {
  id: number;
  result?: unknown;
  error?: { message: string; kind: "denied" | "failed" };
}

/**
 * Something the host announces, rather than answers.
 *
 * On the same port and told apart by having no `id`: a reply is always to a
 * call, so anything without one is the host talking first. One shape rather
 * than a second channel - a second port would be a second thing to transfer,
 * tear down, and get wrong.
 */
interface HostEvent {
  event: "day";
}

const HANDSHAKE = "wiseroutine:addon:port";

/**
 * The handshake, which carries more than a port.
 *
 * `role` and `theme` are both known to the host before your bundle runs and
 * neither can change for the life of the frame, so sending them with the port
 * costs nothing and saves every addon two round trips before its first paint.
 */
interface Handshake {
  type: typeof HANDSHAKE;
  role: AddonRole;
  theme: AddonTheme;
}

const isHandshake = (data: unknown): data is Handshake =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === HANDSHAKE;

/**
 * Connect to the host.
 *
 * Waits for the port the host transfers at load. Call it once, at the top of
 * your entry point, and keep the client.
 *
 * The timeout is not a nicety: an addon left awaiting a port that is never
 * coming shows the user a blank session with no explanation. Ten seconds is
 * far longer than a transfer that happens in the same tick, and short enough
 * that the failure is visible while they are still looking.
 */
export function connect(timeoutMs = 10_000): Promise<AddonClient> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      globalThis.removeEventListener("message", onMessage);
      reject(new AddonError("The host never sent a port.", "failed"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      // The handshake is the only message accepted on the global listener, and
      // everything afterwards travels on the port. A page that could keep
      // talking to the frame's `window` would be a second way in.
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

  port.addEventListener(
    "message",
    (event: MessageEvent<RpcReply | HostEvent>) => {
      const data = event.data;
      if (!data) return;

      // No id means the host spoke first - see `HostEvent`.
      if (!("id" in data)) {
        // Copied before iterating: a listener that unsubscribes itself would
        // otherwise mutate the set mid-loop.
        if (data.event === "day") for (const listen of [...onDay]) listen();
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

  return {
    role: hello.role,
    theme: hello.theme,
    session: <Config>() => call<Session<Config>>("session"),
    card: (card) => call<void>("card", { card }),
    onDayChange: (listener) => {
      onDay.add(listener);
      return () => {
        onDay.delete(listener);
      };
    },
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
        // Only what survives a structured clone and only what an addon should
        // be able to set. A `Headers` instance would not cross, and a body
        // that is a stream cannot be replayed by the host.
        headers: init?.headers,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(reply.body, {
        status: reply.status,
        headers: reply.headers,
      });
    },
    openExternal: (url) => call<boolean>("openExternal", { url }),
    store: {
      get: (key) => call<unknown>("store.get", { key }),
      set: (key, value) => call<void>("store.set", { key, value }),
    },
  };
}
