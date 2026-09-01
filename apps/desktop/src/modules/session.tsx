import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { reloadPlan, usePlan } from "../lib/plan-store";
import { runningSlot, sessionEndOf } from "../lib/running-slot";
import { configFor, moduleFor } from "./activities";

/**
 * The running slot, taking over the window.
 *
 * Mounted once in the app shell rather than by the Today page: a session
 * started from the menu bar has to appear whatever page is open, and a session
 * that vanished because someone navigated to Settings would be a session
 * nobody finished.
 *
 * There is no separate route. A session is a state the day is in - one slot,
 * `started` - not a place, and giving it a URL would mean a back button that
 * abandons a stretch halfway.
 *
 * Only slots whose activity has a module take over. Everything else runs the
 * way it always did: the slot goes live on the timeline, and finishing it is a
 * press on its card.
 */

export const SessionOverlay: React.FC = () => {
  const plan = usePlan();
  /**
   * A session the user has closed, so it does not immediately reopen.
   *
   * Completing a slot is a round trip, and until the reload lands the plan in
   * hand still says `started`. Without this the overlay would close and
   * reappear in the same second, which reads as the button not working.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Read at render rather than held on a timer: the only thing this decides
  // is which of the day's slots is running, and that is re-decided every time
  // the day changes - which is every time it could have changed. A session
  // already on screen is ended by its own module, not by this clock.
  const slot = plan ? runningSlot(plan.slots, Date.now()) : undefined;

  // Forget the dismissal once the plan agrees the slot is over, so the same
  // activity's *next* slot still opens.
  useEffect(() => {
    if (dismissed && slot?.id !== dismissed) setDismissed(null);
  }, [dismissed, slot]);

  if (!slot || slot.id === dismissed) return null;

  const module = moduleFor(slot.presetKey);
  if (!module?.Session) return null;

  const finish = (how: "complete" | "skip") => {
    setDismissed(slot.id);
    const action = how === "complete" ? api.completeSlot : api.skipSlot;
    void action(slot.id)
      .catch(() => {
        // The queue takes it offline; anything else is worth saying, because a
        // session that ran and was not recorded is a number quietly going
        // wrong.
        notify(
          "Couldn't record that just now. It will sync when you reconnect.",
        );
      })
      // Always, and this is what makes a stopped session resumable.
      //
      // Without it the plan in hand still said `started` long after the
      // session had been skipped, so `dismissed` never cleared - and pressing
      // Start again reloaded a day that already said `started`, found the
      // slot still dismissed, and did nothing at all. The button stayed there
      // looking pressable forever.
      .finally(() => reloadPlan());
  };

  const Session = module.Session;
  return (
    <Session
      slot={{ ...slot, endsAt: sessionEndOf(slot) }}
      config={configFor(module, slot.configJson)}
      onDone={() => finish("complete")}
      onSkip={() => finish("skip")}
    />
  );
};
