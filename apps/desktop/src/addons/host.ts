import {
  type AddonCapability,
  type AddonManifest,
  canAddon,
} from "@wiseroutine/addons";
import { api } from "../lib/api";
import { todaySnapshot } from "../lib/plan-store";

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

/** What the host loaded this addon to do. */
export type AddonContext = {
  kind: "session";
  slot: unknown;
  config: unknown;
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
  context: AddonContext,
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
      if (context.kind !== "session") {
        throw new Denied("This addon was not loaded as a session.");
      }
      return { slot: context.slot, config: context.config };
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

  return () => {
    port.removeEventListener("message", onMessage);
  };
}
