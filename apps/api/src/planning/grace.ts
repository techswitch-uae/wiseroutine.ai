/**
 * What to do with a slot whose moment has arrived and which nobody has touched.
 *
 * Pure, and separate from the sweep that carries it out, because it is four
 * interacting rules and every one of them is a promise the app makes: that an
 * eye rest starts itself, that a slot you placed by hand stays where you put
 * it, that "moves itself in 3 min" means three minutes and not none, and that
 * nothing is dragged around the day for ever.
 *
 * The order matters and is not arbitrary. Policy first, because `auto` applies
 * to a locked slot too; the lock next, because a hand-placed slot must never
 * be moved whatever else is true; then grace, then the thrash cap.
 */

const MINUTE = 60_000;

/** Only what the decision reads. Deliberately narrower than `DueSlot`, so a
 *  test can state a case in four fields rather than fourteen. */
export interface GraceInput {
  startsAt: number;
  /** "manual" | "auto" | "prompt" */
  startPolicy: string;
  /** How long to wait after the start before giving up and moving it on. */
  graceMinutes: number;
  /** Placed or pinned by the user. Never moved by anything here. */
  isLocked: boolean;
  autoMoveCount: number;
}

export type GraceAction =
  /** Begin it without being asked - the `auto` policy. */
  | "start"
  /** Leave it exactly as it is, this sweep and possibly for ever. */
  | "leave"
  /** Stop trying, and let the missed list explain why. */
  | "miss"
  /** Push it to the next gap and count the move. */
  | "move";

export function graceAction(slot: GraceInput, now: number): GraceAction {
  // An activity that starts itself. A slot you have to press a button for is a
  // slot you skip, and this is the whole reason the policy exists.
  if (slot.startPolicy === "auto") return "start";

  // The free plan's promise. A meeting landing on top of this is a clash the
  // user is asked to resolve, not something moved out from under them.
  if (slot.isLocked) return "leave";

  // "Moves itself in 3 min if you don't start", using the activity's own
  // number. `prompt` waits exactly as long as `manual` does - the difference
  // between them is whether a notification went out, which is the client's
  // job, not this one's.
  if (now < slot.startsAt + slot.graceMinutes * MINUTE) return "leave";

  // After two automatic moves in a day, stop guessing. A third move is not
  // more helpful than an honest "this did not fit today".
  if (slot.autoMoveCount >= 2) return "miss";

  return "move";
}
