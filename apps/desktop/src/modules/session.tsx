import { canStopSlot } from "@wiseroutine/scheduler";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { captureError } from "../lib/capture";
import { useFeatures } from "../lib/features";
import { notify } from "../lib/notify";
import { reloadPlan, useTodayPlan } from "../lib/plan-store";
import { runningSlot, sessionEndOf } from "../lib/running-slot";
import { configFor, moduleFor } from "./activities";
import { SessionActions } from "./session-actions";

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
  const plan = useTodayPlan();
  const flags = useFeatures();
  const pending = useRef(false);
  /**
   * A session the user has closed, so it does not immediately reopen.
   *
   * Completing a slot is a round trip, and until the reload lands the plan in
   * hand still says `started`. Without this the overlay would close and
   * reappear in the same second, which reads as the button not working.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const slot = plan ? runningSlot(plan.slots, Date.now()) : undefined;

  // Forget the dismissal once the plan agrees the slot is over, so the same
  // activity's *next* slot still opens.
  useEffect(() => {
    if (dismissed && slot?.id !== dismissed) setDismissed(null);
  }, [dismissed, slot]);

  if (!slot || slot.id === dismissed) return null;

  const module = moduleFor(slot.presetKey);
  if (!flags.guided_sessions || !module?.Session) return null;

  const finish = (how: "complete" | "skip") => {
    if (pending.current) return;
    if (how === "skip" && !canStopSlot(slot, Date.now())) {
      notify(
        "The stop window has closed. You can create another slot instead.",
      );
      return;
    }
    pending.current = true;
    setDismissed(slot.id);
    const action = how === "complete" ? api.completeSlot : api.skipSlot;
    void action(slot.id)
      .catch((error) => {
        setDismissed(null);
        notify(captureError(error, "Couldn't record that. Please try again."));
      })
      // Always, and this is what makes a stopped session resumable.
      //
      // Without it the plan in hand still said `started` long after the
      // session had been skipped, so `dismissed` never cleared - and pressing
      // Start again reloaded a day that already said `started`, found the
      // slot still dismissed, and did nothing at all. The button stayed there
      // looking pressable forever.
      .finally(() => {
        pending.current = false;
        reloadPlan();
      });
  };

  const Session = module.Session;
  return (
    <SessionActions.Provider value={{ slot }}>
      <Session
        slot={{ ...slot, endsAt: sessionEndOf(slot) }}
        config={configFor(module, slot.configJson)}
        onDone={() => finish("complete")}
        onSkip={() => finish("skip")}
      />
    </SessionActions.Provider>
  );
};
