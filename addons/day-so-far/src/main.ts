/**
 * The entry point.
 *
 * A widget, not a session - the first addon in this repo that contributes no
 * activity type at all. So it never calls `session()`, and the shape of its
 * life is different from the other four: a session runs once for as long as
 * its slot, and a card sits in the rail for as long as the app is open,
 * redrawing whenever the day underneath it changes.
 *
 * Three things follow from that, and they are the whole file:
 *
 * 1. **It asks to be shown, and it can ask not to be.** A day with no blocks
 *    is not a day with nothing to report - it is a day this card knows nothing
 *    about, and it says so by taking itself off the rail rather than by
 *    drawing "0 / 0". The first-party card this replaces did the same by
 *    returning null; `card(null)` is that, across a port.
 * 2. **It is pushed, not polled.** `onDayChange` fires when a slot is
 *    completed, skipped or moved, and the card is redrawn from a fresh `day()`
 *    within a frame of the press. A timer would have been the lazier thing to
 *    write and would have left the card disagreeing with the timeline beside
 *    it for up to its interval.
 * 3. **It still keeps one clock.** Not for the data - the data is pushed - but
 *    because half of what the card says is about *now*: a block whose window
 *    closes while nobody presses anything moves from "to go" to "overdue" with
 *    no server event behind it. A minute is fine; nothing here is to the
 *    second.
 */

import { connect } from "@wiseroutine/addon-sdk";
import { fill, heightOf, markup } from "./card";
import { settledOf, tallyOf, totalOf } from "./day";

async function main(): Promise<void> {
  const wr = await connect();
  if (wr.role.kind !== "widget") return;

  let drawn = false;

  const draw = async () => {
    const day = await wr.day();
    const tally = tallyOf(day.slots, Date.now());

    // Nothing on the day at all. Off the rail rather than an empty card - an
    // ink surface with a label and no content reads as something that failed
    // to load, and it takes a place in the rail from a card that has something
    // to say.
    if (totalOf(tally) === 0) {
      drawn = false;
      await wr.card(null);
      return;
    }

    // Written once, then updated in place. Rewriting it would restart the
    // bar's transition from zero on every change - see `fill`.
    if (!drawn) {
      document.body.innerHTML = markup(tally, day.timeZone, wr.theme);
      drawn = true;
    }
    fill(document.body, tally, day.timeZone);

    await wr.card({
      // The one thing that cannot be a fixed name: whether the day is still
      // going is a reading of the data, not a fact about this addon.
      eyebrow: settledOf(tally) ? "Day done" : "Day so far",
      // After `fill`, so what is measured is what the card actually says.
      height: heightOf(document),
    });
  };

  const redraw = () => void draw().catch(() => undefined);

  wr.onDayChange(redraw);
  // See (3) above: the clock moves blocks between buckets with no event.
  const timer = setInterval(redraw, 30_000);
  globalThis.addEventListener("pagehide", () => clearInterval(timer));

  await draw();
}

void main().catch(() => {
  // Silent, and this is the one place in the repo where that is right. A
  // session that fails owes the user an explanation because they opened it and
  // are looking at it. A card that fails was never asked for by anybody, and
  // an error message sitting in the rail for the rest of the day is worse than
  // the card simply not being there - which is what never calling `card()`
  // already means.
});
