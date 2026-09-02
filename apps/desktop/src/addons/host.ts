import type { WidgetCard } from "@wiseroutine/addon-sdk";
import {
  type AddonCapability,
  type AddonManifest,
  canAddon,
  cardHeightFor,
  isPlainHttpsOrigin,
} from "@wiseroutine/addons";
import { api, openGaps, type Todo } from "../lib/api";
import { notify as toast } from "../lib/notify";
import { openExternal } from "../lib/open-external";
import { reloadPlan, subscribePlan, todaySnapshot } from "../lib/plan-store";
import {
  DEFAULT_TODO_MINUTES,
  fitsAt,
  reloadTodos,
  subscribeTodos,
  todosSnapshot,
} from "../lib/todos";

/**
 * The one place an addon's requests are answered.
 *
 * Every call arrives here on a port nobody else holds. Three rules, in
 * order: the method must exist; the capability must be in the user's grant
 * (`canAddon`, the same function the Worker uses); and writes go to the
 * server with the addon's id, where the grant and ownership are checked
 * again. That server check is the gate. This one gives a better error.
 *
 * The addon never holds a token, a URL or a secret. It holds a port.
 */

/** What the host needs to serve an addon. `InstalledAddon` satisfies it. */
export interface ServedAddon {
  manifest: AddonManifest;
  /** The user's grant. Checked here; never the manifest. */
  granted: readonly AddonCapability[];
  /** Addon-level settings, parsed. Never secrets. */
  settings?: Record<string, unknown>;
}

/** Why this frame exists. Decides what it may ask for. */
export type AddonContext =
  | {
      kind: "session";
      slot: unknown;
      config: unknown;
      /** Ends the session as done. The host completes the slot. */
      finish: () => void;
    }
  | {
      kind: "widget";
      widgetKey: string;
      /** How to draw the card, or null to take it down. */
      present: (card: { eyebrow?: string; height: number } | null) => void;
    }
  | { kind: "background" };

interface Request {
  id: number;
  method: string;
  params?: unknown;
}

class Denied extends Error {}

/** Every port being served, so the host can speak first. */
const served = new Map<
  string,
  { port: MessagePort; kind: AddonContext["kind"] }[]
>();

const QUICK_ADD_TIMEOUT = 8_000;
let nextQuickAddId = 1;

/**
 * Hand Quick add's text to an addon and wait for its answer.
 *
 * Goes to the addon's background frame if it has one, else its first frame.
 * Resolves with what the addon said, or a failure if it threw, went away, or
 * took too long.
 */
export function dispatchQuickAdd(
  addonId: string,
  request: { key: string; title: string; minutes: number | null },
): Promise<{ ok: boolean; message?: string }> {
  const frames = served.get(addonId) ?? [];
  const target =
    frames.find((f) => f.kind === "background") ?? frames[0] ?? null;
  if (!target) {
    return Promise.resolve({ ok: false, message: "That addon isn't running." });
  }

  const requestId = nextQuickAddId++;
  return new Promise((resolve) => {
    const done = (answer: { ok: boolean; message?: string }) => {
      clearTimeout(timer);
      target.port.removeEventListener("message", onMessage);
      resolve(answer);
    };
    const timer = setTimeout(
      () => done({ ok: false, message: "That addon did not answer." }),
      QUICK_ADD_TIMEOUT,
    );
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        event?: string;
        requestId?: number;
        message?: string;
        error?: string;
      };
      if (data?.event !== "quickAdd:done" || data.requestId !== requestId)
        return;
      if (typeof data.error === "string") {
        done({ ok: false, message: data.error.slice(0, 80) });
      } else {
        done({
          ok: true,
          ...(typeof data.message === "string"
            ? { message: data.message.slice(0, 80) }
            : {}),
        });
      }
    };
    target.port.addEventListener("message", onMessage);
    target.port.postMessage({ event: "quickAdd", requestId, request });
  });
}

/** Whether an addon has a frame up to hear `dispatchQuickAdd`. */
export const isServing = (addonId: string): boolean =>
  (served.get(addonId)?.length ?? 0) > 0;

const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

const STORE_VALUE_LIMIT = 16 * 1024;
const NOTIFY_INTERVAL = 10_000;
const lastNotified = new Map<string, number>();

/** Is `[startsAt, endsAt]` inside one open gap on today? */
function isFree(startsAt: number, endsAt: number, now: number): boolean {
  const plan = todaySnapshot();
  if (!plan) return false;
  const minutes = Math.ceil((endsAt - startsAt) / 60_000);
  return openGaps(plan, now, minutes).some(
    (gap) => gap.startsAt <= startsAt && endsAt <= gap.endsAt,
  );
}

/**
 * Answer requests on this port until it is stopped. Returns the teardown,
 * which must be called: a port left open is an addon still able to act
 * after its frame is gone.
 */
export function serve(
  port: MessagePort,
  addon: ServedAddon,
  /** Read per request, not captured, so the port survives re-renders. */
  contextOf: () => AddonContext,
): () => void {
  const { manifest, granted } = addon;
  const id = manifest.id;

  const require = (capability: AddonCapability): void => {
    const decision = canAddon(granted, capability);
    if (!decision.ok) throw new Denied(decision.reason);
  };

  const toDaySlot = (slot: {
    id: string;
    title: string;
    kind: "recovery" | "focus" | "task";
    startsAt: number;
    endsAt: number;
    status: string;
    ownerAddonId?: string | null;
  }) => ({
    id: slot.id,
    title: slot.title,
    kind: slot.kind,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    status: slot.status,
    ownedByYou: slot.ownerAddonId === id,
  });

  const handlers: Record<string, (params: unknown) => Promise<unknown>> = {
    /** Given, not asked for: the addon cannot name a different slot. */
    session: async () => {
      require({ kind: "ui:session" });
      const context = contextOf();
      if (context.kind !== "session") {
        throw new Denied("This addon was not loaded as a session.");
      }
      return { slot: context.slot, config: context.config };
    },

    finishSession: async () => {
      require({ kind: "ui:session" });
      const context = contextOf();
      if (context.kind !== "session") {
        throw new Denied("This addon was not loaded as a session.");
      }
      context.finish();
      return undefined;
    },

    /** The one thing an addon says about the outside of its frame. Height
     *  clamped, eyebrow truncated, null takes the card down. */
    card: async (params) => {
      require({ kind: "ui:widget" });
      const context = contextOf();
      if (context.kind !== "widget") {
        throw new Denied("This addon was not loaded as a widget.");
      }

      const { card } = (params ?? {}) as { card?: unknown };
      if (card === null || card === undefined) {
        context.present(null);
        return undefined;
      }
      if (typeof card !== "object") throw new Denied("That is not a card.");

      const { eyebrow, height } = card as WidgetCard;
      context.present({
        ...(typeof eyebrow === "string"
          ? { eyebrow: eyebrow.slice(0, 40) }
          : {}),
        height: cardHeightFor(height),
      });
      return undefined;
    },

    settings: async () => addon.settings ?? {},

    /** The day, narrowed to what an addon may see. */
    day: async () => {
      require({ kind: "read:schedule", scope: "today" });
      const plan = todaySnapshot();
      if (!plan) return { dayStart: 0, dayEnd: 0, timeZone: "UTC", slots: [] };

      return {
        dayStart: plan.dayStart,
        dayEnd: plan.dayEnd,
        timeZone: plan.timeZone,
        slots: plan.slots.map(toDaySlot),
      };
    },

    /**
     * A slot of the addon's own. Pinned at `startsAt`, or the first
     * `preferredAt` that is free, or the first free gap today. The server
     * re-checks the gap and records the owner.
     */
    placeSlot: async (params) => {
      require({ kind: "write:own" });
      const p = (params ?? {}) as Record<string, unknown>;
      const title = typeof p.title === "string" ? p.title.trim() : "";
      if (title.length === 0) throw new Denied("A slot needs a title.");
      const kind = p.kind;
      if (kind !== "recovery" && kind !== "focus" && kind !== "task") {
        throw new Denied("kind must be recovery, focus or task.");
      }
      const minutes = p.minutes;
      if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 240
      ) {
        throw new Denied("minutes must be a whole number from 1 to 240.");
      }
      const length = minutes * 60_000;
      const now = Date.now();

      let at: number | null = null;
      if (typeof p.startsAt === "number" && Number.isFinite(p.startsAt)) {
        at = p.startsAt;
      } else {
        const preferred = Array.isArray(p.preferredAt)
          ? p.preferredAt.filter(
              (t): t is number => typeof t === "number" && Number.isFinite(t),
            )
          : [];
        at =
          preferred.slice(0, 10).find((t) => isFree(t, t + length, now)) ??
          fitsAt(minutes, todaySnapshot(), now);
      }
      if (at === null) throw new Denied("Nothing on today fits it.");

      const slot = await api.placeOwnSlot(id, {
        title: title.slice(0, 200),
        kind,
        startsAt: at,
        endsAt: at + length,
      });
      reloadPlan();
      return toDaySlot(slot);
    },

    /** The server refuses a slot this addon did not place. */
    setSlotStatus: async (params) => {
      require({ kind: "write:own" });
      const { slotId, status } = (params ?? {}) as {
        slotId?: unknown;
        status?: unknown;
      };
      if (typeof slotId !== "string") throw new Denied("No slot named.");
      if (status !== "completed" && status !== "skipped") {
        throw new Denied("A slot may be completed or skipped, nothing else.");
      }
      if (status === "completed") await api.completeSlot(slotId, id);
      else await api.skipSlot(slotId, undefined, id);
      reloadPlan();
      return undefined;
    },

    /**
     * Fetch through Rust, which checks the origin against the grant, adds
     * the auth header from the user's secret if the grant declares one, and
     * caps the response. The web build has no Rust, so it refuses.
     */
    fetch: async (params) => {
      const p = (params ?? {}) as {
        input?: unknown;
        method?: unknown;
        headers?: unknown;
        body?: unknown;
      };
      if (typeof p.input !== "string") throw new Denied("No URL given.");
      let origin: string;
      try {
        origin = new URL(p.input).origin;
      } catch {
        throw new Denied("That is not a URL.");
      }
      require({ kind: "net:fetch", origins: [origin] });
      if (!inTauri()) {
        throw new Denied("Host fetch is only available in the desktop app.");
      }
      const headers: Record<string, string> = {};
      if (typeof p.headers === "object" && p.headers !== null) {
        for (const [k, v] of Object.entries(p.headers)) {
          if (typeof v === "string") headers[k] = v;
        }
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const reply = await invoke<{
        status: number;
        headers: [string, string][];
        body: string;
      }>("addon_fetch", {
        id,
        url: p.input,
        method: typeof p.method === "string" ? p.method : "GET",
        headers,
        body: typeof p.body === "string" ? p.body : null,
      }).catch((cause: unknown) => {
        throw new Denied(typeof cause === "string" ? cause : "Fetch failed.");
      });
      return reply;
    },

    /** https only, and the origin must be in the grant. Re-checked per URL,
     *  because an addon may compute the one it opens. */
    openExternal: async (params) => {
      const { url } = (params ?? {}) as { url?: unknown };
      if (typeof url !== "string") throw new Denied("No link given.");

      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        throw new Denied("That is not a link.");
      }
      if (!isPlainHttpsOrigin(origin)) {
        throw new Denied("Only https links can be opened.");
      }

      require({ kind: "open:external", origins: [origin] });
      return openExternal(url);
    },

    /** Labelled with the addon's name so it cannot pass as the app. At most
     *  one every ten seconds per addon. */
    notify: async (params) => {
      require({ kind: "notify" });
      const { title, body } = (params ?? {}) as {
        title?: unknown;
        body?: unknown;
      };
      if (typeof title !== "string" || title.trim().length === 0) {
        throw new Denied("A notification needs a title.");
      }
      const now = Date.now();
      if (now - (lastNotified.get(id) ?? 0) < NOTIFY_INTERVAL) {
        throw new Denied("Too many notifications. Wait a moment.");
      }
      lastNotified.set(id, now);

      const heading = `${manifest.name}: ${title.trim().slice(0, 80)}`;
      const text = typeof body === "string" ? body.slice(0, 200) : undefined;
      if (inTauri()) {
        const { sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        sendNotification({ title: heading, ...(text ? { body: text } : {}) });
      } else {
        toast(text ? `${heading} — ${text}` : heading);
      }
      return undefined;
    },

    /** On this device, in the app's own storage, under the addon's id. */
    "store.get": async (params) => {
      const { key } = (params ?? {}) as { key?: unknown };
      const raw = globalThis.localStorage?.getItem(storeKey(id, key));
      if (raw === null || raw === undefined) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },

    "store.set": async (params) => {
      const { key, value } = (params ?? {}) as {
        key?: unknown;
        value?: unknown;
      };
      const name = storeKey(id, key);
      if (value === undefined) {
        globalThis.localStorage?.removeItem(name);
        return undefined;
      }
      const text = JSON.stringify(value);
      if (typeof text !== "string") throw new Denied("Not a JSON value.");
      if (text.length > STORE_VALUE_LIMIT) {
        throw new Denied("Too large. The store holds 16 KB per key.");
      }
      try {
        globalThis.localStorage?.setItem(name, text);
      } catch {
        throw new Denied("The store is full.");
      }
      return undefined;
    },

    "todos.list": async () => {
      require({ kind: "read:todos" });
      if (todosSnapshot() === null) await reloadTodos();
      const known = todosSnapshot();
      const plan = todaySnapshot();
      const now = Date.now();
      return (known ?? []).map((todo: Todo) => ({
        id: todo.id,
        title: todo.title,
        minutes: todo.minutes,
        needsFocus: todo.needsFocus,
        fitsAt: fitsAt(todo.minutes ?? DEFAULT_TODO_MINUTES, plan, now),
      }));
    },

    "todos.add": async (params) => {
      require({ kind: "write:todos" });
      const { title, minutes } = (params ?? {}) as {
        title?: unknown;
        minutes?: unknown;
      };
      if (typeof title !== "string" || title.trim().length === 0) {
        throw new Denied("A todo needs a title.");
      }
      const todo = await api.createTodo(
        {
          title: title.trim().slice(0, 200),
          minutes: typeof minutes === "number" ? minutes : null,
        },
        id,
      );
      await reloadTodos();
      return { ...todo, fitsAt: null };
    },

    "todos.set": async (params) => {
      require({ kind: "write:todos" });
      const { id: todoId, status } = (params ?? {}) as {
        id?: unknown;
        status?: unknown;
      };
      if (typeof todoId !== "string") throw new Denied("No todo named.");
      if (status !== "done" && status !== "dropped") {
        throw new Denied("A todo may be done or dropped, nothing else.");
      }
      await api.setTodo(todoId, status, id);
      await reloadTodos();
      return undefined;
    },

    "todos.place": async (params) => {
      require({ kind: "write:todos" });
      const { id: todoId, startsAt } = (params ?? {}) as {
        id?: unknown;
        startsAt?: unknown;
      };
      if (typeof todoId !== "string") throw new Denied("No todo named.");
      const todo = todosSnapshot()?.find((t) => t.id === todoId);
      if (!todo) throw new Denied("That todo is not on the list.");
      const minutes = todo.minutes ?? DEFAULT_TODO_MINUTES;
      const at =
        typeof startsAt === "number"
          ? startsAt
          : fitsAt(minutes, todaySnapshot(), Date.now());
      if (at === null) throw new Denied("Nothing on today fits it.");
      const slot = await api.placeTodo(todoId, at, at + minutes * 60_000, id);
      reloadPlan();
      await reloadTodos();
      return toDaySlot(slot);
    },
  };

  const onMessage = (event: MessageEvent<Request>) => {
    const { id: callId, method, params } = event.data ?? {};
    if (typeof callId !== "number" || typeof method !== "string") return;

    const handler = handlers[method];
    if (!handler) {
      port.postMessage({
        id: callId,
        error: { message: `No such method: ${method}`, kind: "denied" },
      });
      return;
    }

    handler(params)
      .then((result) => port.postMessage({ id: callId, result }))
      .catch((error: unknown) => {
        const denied = error instanceof Denied;
        port.postMessage({
          id: callId,
          error: {
            // A denial is written to be read. Anything else is ours, and
            // an error string is where internals leak out.
            message: denied
              ? (error as Error).message
              : "That did not work just now.",
            kind: denied ? "denied" : "failed",
          },
        });
      });
  };

  port.addEventListener("message", onMessage);
  port.start();

  // Pushed rather than polled. Carries nothing: the addon asks again.
  const stopWatching = subscribePlan(() => {
    try {
      port.postMessage({ event: "day" });
    } catch {
      // A closed port, between the change and the post.
    }
  });
  const stopWatchingTodos = subscribeTodos(() => {
    try {
      port.postMessage({ event: "todos" });
    } catch {
      // As above.
    }
  });

  const entry = { port, kind: contextOf().kind };
  served.set(id, [...(served.get(id) ?? []), entry]);

  return () => {
    const rest = (served.get(id) ?? []).filter((p) => p !== entry);
    if (rest.length > 0) served.set(id, rest);
    else served.delete(id);
    stopWatchingTodos();
    stopWatching();
    port.removeEventListener("message", onMessage);
  };
}

const STORE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

function storeKey(addonId: string, key: unknown): string {
  if (typeof key !== "string" || !STORE_KEY.test(key)) {
    throw new Denied(
      "A store key is letters, digits, dot, dash or underscore.",
    );
  }
  return `wr.addon.${addonId}.${key}`;
}
