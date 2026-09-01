import type { WidgetCard } from "@wiseroutine/addon-sdk";
import {
  type AddonCapability,
  type AddonManifest,
  canAddon,
  cardHeightFor,
  isPlainHttpsOrigin,
} from "@wiseroutine/addons";
import { api } from "../lib/api";
import { openExternal } from "../lib/open-external";
import { subscribePlan, todaySnapshot } from "../lib/plan-store";

/**
 * The one place an addon's requests are answered.
 *
 * Every call an addon can make arrives here, on a port nobody else holds, and
 * leaves through one of the handlers below. That is deliberate and it is the
 * property worth protecting: a second way in would be a second place to get
 * the capability check right, and the value of a chokepoint is that there is
 * only one of it.
 *
 * Three rules, applied in this order to every request:
 *
 * 1. **The method must exist.** An unknown name is refused rather than
 *    ignored, so an addon written against a newer host gets a sentence rather
 *    than a promise that never settles.
 * 2. **The capability must be granted.** Checked against the manifest with
 *    `canAddon`, the same function the Worker uses. Not the request's word for
 *    what it needs - the handler names it.
 * 3. **Ownership, for anything that writes.** Checked here, and *again* by the
 *    server. This one is a courtesy that gives a better error; the server's is
 *    the gate.
 *
 * The addon never holds a token, a URL or a database handle. It holds a port.
 */

/**
 * What the host loaded this addon to do.
 *
 * A union rather than a single shape, because an addon is loaded for a reason
 * and the reason decides what it may ask for. `session` and `card` are each
 * refused outright in the other's context - not because the capability is
 * missing, but because the question is meaningless: a rail card has no slot,
 * and a session has no eyebrow to set.
 */
export type AddonContext =
  | { kind: "session"; slot: unknown; config: unknown }
  | {
      kind: "widget";
      /** Bare, as the manifest wrote it. See `AddonRole`. */
      widgetKey: string;
      /**
       * How the card around this frame should be drawn, or null to take it
       * down. The host's own state setter, handed in - so `serve` decides
       * nothing about the rail and the component that owns the card owns it.
       */
      present: (card: { eyebrow?: string; height: number } | null) => void;
    };

interface Request {
  id: number;
  method: string;
  params?: unknown;
}

class Denied extends Error {}

/**
 * Answer requests on this port until it is stopped.
 *
 * Returns the teardown. Not optional: a port left listening after its frame is
 * gone is an addon that can still act after the user closed it.
 */
export function serve(
  port: MessagePort,
  manifest: AddonManifest,
  /**
   * Read per request, not captured.
   *
   * A function rather than a value so that the port survives its owner
   * re-rendering. The context is rebuilt on every render of the component
   * drawing the frame - it is an object literal - so a `serve` that closed
   * over it would have to be torn down and rebuilt each time to stay current,
   * and rebuilding it after the frame has loaded hands the addon a port it
   * never receives. A widget in the rail re-renders for the rest of the app's
   * life; a session that had gone quiet was the same bug arriving slower.
   */
  contextOf: () => AddonContext,
): () => void {
  const granted = manifest.capabilities;

  const require = (capability: AddonCapability): void => {
    const decision = canAddon(granted, capability);
    if (!decision.ok) throw new Denied(decision.reason);
  };

  const handlers: Record<string, (params: unknown) => Promise<unknown>> = {
    /**
     * The session this frame was loaded for.
     *
     * Given rather than asked for: the addon does not name a slot, so it
     * cannot name a different one. `ui:session` is the capability, not
     * `read:schedule` - the running slot is not a window onto the day, it is
     * the thing the user is looking at while this addon draws it.
     */
    session: async () => {
      require({ kind: "ui:session" });
      const context = contextOf();
      if (context.kind !== "session") {
        throw new Denied("This addon was not loaded as a session.");
      }
      return { slot: context.slot, config: context.config };
    },

    /**
     * How the card around this frame is drawn - or whether it is drawn at all.
     *
     * The one thing an addon may say about the outside of its own frame, and
     * everything about it is bounded here rather than trusted:
     *
     * - The height is clamped by `cardHeightFor`. A card that could name its
     *   own height could push every other card in the rail off the screen.
     * - The eyebrow is truncated, and it is the only text the host draws on
     *   the addon's behalf. Long enough for "Day so far", short enough that it
     *   cannot become a paragraph wearing a label's clothes.
     * - `null` takes the card down. The addon can hide itself and nothing
     *   else: it has no way to hide another card, or to say anything about
     *   where in the rail it sits.
     */
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

    /**
     * The day, narrowed to what an addon may see.
     *
     * `today` is the only grantable scope, so this reads the day already in
     * hand rather than making a request: a wider window would need a wider
     * grant, and there is no way to ask for one yet.
     *
     * Rebuilt field by field rather than passed through. The app's own slot
     * carries conflict ids, lock state and a module key; an addon is shown
     * what it needs and `ownedByYou`, which is the only field that decides
     * anything for it.
     */
    day: async () => {
      require({ kind: "read:schedule", scope: "today" });
      const plan = todaySnapshot();
      if (!plan) return { dayStart: 0, dayEnd: 0, timeZone: "UTC", slots: [] };

      return {
        dayStart: plan.dayStart,
        dayEnd: plan.dayEnd,
        timeZone: plan.timeZone,
        slots: plan.slots.map((slot) => ({
          id: slot.id,
          title: slot.title,
          kind: slot.kind,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          status: slot.status,
          // Until the server returns an owner per slot there is nothing an
          // addon owns, and saying so is the honest answer: a write against
          // any of these is refused, so claiming otherwise would only produce
          // a request that fails later and further away.
          ownedByYou: false,
        })),
      };
    },

    placeSlot: async () => {
      require({ kind: "write:own" });
      throw new Denied(
        "Placing slots is not available yet. The capability exists; the route does not.",
      );
    },

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
      // The server checks `owner_addon_id` and refuses a slot this addon does
      // not own. Reached through the app's own client, so an addon's write
      // takes the same offline queue and the same retries as the user's.
      const act = status === "completed" ? api.completeSlot : api.skipSlot;
      await act(slotId);
      return undefined;
    },

    fetch: async () => {
      // Refused rather than unimplemented: an addon granted `net:fetch` may
      // already call `fetch` itself, and the frame's CSP is what bounds it.
      // This method exists for the case the host holds a credential the addon
      // does not, and there are no connected integrations yet to hold one for.
      throw new Denied(
        "Host-side fetch is not available yet. Use fetch() for your declared origins.",
      );
    },

    /**
     * Hand a link to the machine.
     *
     * Three checks, and none of them is redundant:
     *
     * 1. The capability is granted at all.
     * 2. The URL parses and is a plain `https://` - so no `file:`, no
     *    `x-apple.systempreferences:`, nothing that is an instruction to the
     *    operating system wearing a link's clothes. The app opens such URLs
     *    itself and is entitled to; an addon is not.
     * 3. The *origin* is one the manifest declared. This is the one that
     *    matters and the reason the grant alone is not enough: an addon may
     *    compute the URL it opens, so what was approved has to be re-checked
     *    against what is actually being opened, every time.
     */
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

    "store.get": async () => {
      throw new Denied("Addon storage is not available yet.");
    },

    "store.set": async () => {
      throw new Denied("Addon storage is not available yet.");
    },
  };

  const onMessage = (event: MessageEvent<Request>) => {
    const { id, method, params } = event.data ?? {};
    if (typeof id !== "number" || typeof method !== "string") return;

    const handler = handlers[method];
    if (!handler) {
      port.postMessage({
        id,
        error: { message: `No such method: ${method}`, kind: "denied" },
      });
      return;
    }

    handler(params)
      .then((result) => port.postMessage({ id, result }))
      .catch((error: unknown) => {
        const denied = error instanceof Denied;
        port.postMessage({
          id,
          error: {
            // A denial's text is written to be read by the user. Anything else
            // is ours, and an addon is told that it failed rather than how -
            // an error string is a place internals leak out through.
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

  /**
   * Tell the addon when the day it drew is no longer the day.
   *
   * The only message the host sends unprompted, and the reason a rail card is
   * viable at all. `day()` is a pull, so without this every widget wanting to
   * stay current would run a timer: a wakeup the machine pays for whether or
   * not anything happened, and a card that goes on saying "3 of 7 done" for
   * the rest of the interval after the user pressed Done.
   *
   * It carries nothing. A payload here would be a second copy of the narrowing
   * in `day` - the same fields, filtered the same way, in a second place to get
   * wrong - so the addon is told to ask again rather than told the answer.
   *
   * Sent whatever the addon was granted. It is not data: an addon without
   * `read:schedule` learns that something happened, which it could equally
   * learn from a clock, and its `day()` is refused exactly as before.
   */
  const stopWatching = subscribePlan(() => {
    try {
      port.postMessage({ event: "day" });
    } catch {
      // A closed port. The teardown below is the ordinary path; this is the
      // race where the frame went away between the change and the post.
    }
  });

  return () => {
    stopWatching();
    port.removeEventListener("message", onMessage);
  };
}
