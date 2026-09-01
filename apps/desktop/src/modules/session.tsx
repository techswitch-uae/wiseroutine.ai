import { useEffect, useState } from "react";
import { api, type TodaySlot } from "../lib/api";
import { notify } from "../lib/notify";
import { reloadPlan, usePlan } from "../lib/plan-store";
import { runningSlot, startedAtOf } from "../lib/running-slot";
import { configFor, moduleFor } from "./activities";

/**
 * How long the session actually runs for.
 *
 * Not simply `slot.endsAt`, which is where the block is *parked* on the day.
 * A three-minute breathing block you press six minutes early was counting down
 * to its parking space, so it opened saying "9 min left" and would have paced
 * you for nine. What was asked for is three minutes of breathing, and the
 * press is the only thing that knows when they began.
 *
 * Still capped at the block's own end, because `runningSlot` closes the
 * overlay there: a session allowed to run past it would be taken off screen
 * mid-breath. So a late start gets the rest of its window rather than a fresh
 * full length.
 *
 * ponytail: derived at render from the press instant `markStarted` already
 * keeps. The alternative - the server re-anchoring the slot on start - moves
 * a block on the timeline out from under the user, and needs a migration to
 * store what the press already knows.
 */
const sessionEndOf = (slot: TodaySlot): number => {
  const startedAt = startedAtOf(slot.id);
  if (startedAt === undefined) return slot.endsAt;
  return Math.min(startedAt + (slot.endsAt - slot.startsAt), slot.endsAt);
};

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
