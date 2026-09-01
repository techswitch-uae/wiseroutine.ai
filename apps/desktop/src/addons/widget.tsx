import {
  type AddonContribution,
  CARD_BOUNDS,
  qualify,
} from "@wiseroutine/addons";
import { Widget } from "@wiseroutine/design";
import { useCallback, useState } from "react";
import { AddonFrame } from "./frame";
import { type InstalledAddon, useInstalledAddons } from "./installed";

/**
 * An addon's card in the rail.
 *
 * The counterpart of `activity-type.tsx`, and built on the same principle: the
 * host draws the frame around the addon and the addon draws the inside.
 * `Widget` is the app's own card - its ground, its radius, its spacing, its
 * entrance animation - so a third-party card cannot be a different shape from
 * the two above it, and cannot paint itself to look like a system message.
 *
 * ## What the addon gets to decide
 *
 * Three things, all of them through one call (`wr.card`), all of them bounded:
 * the eyebrow, the height, and whether the card is there at all.
 *
 * The last one earns its place. `DayProgress` - the first-party card this
 * replaced - returned null on a day with no blocks, because an empty surface
 * in the rail reads as something that failed to load. An addon needs the same
 * answer available to it, and it cannot be decided from the manifest: whether
 * there is anything to say is a reading of the data, made after the data
 * arrives.
 *
 * ## Why it starts hidden
 *
 * The frame is mounted and the card around it is not drawn until the addon
 * calls `card()`. The other way round - visible until retracted - means every
 * addon with nothing to say flashes a card and takes it away again, on every
 * load, in the corner of the user's eye.
 *
 * The frame has to be mounted for that call to happen, so it is: hidden, and
 * running. That is also what lets an addon come *back* - the day gains its
 * first block, `onDayChange` fires, and the card appears without anything
 * remounting.
 */

/** What the addon last said about its own card, or null for "not on screen". */
interface Card {
  eyebrow?: string;
  height: number;
}

const AddonWidget: React.FC<{
  addon: InstalledAddon;
  contribution: AddonContribution;
}> = ({ addon, contribution }) => {
  const [card, setCard] = useState<Card | null>(null);

  /**
   * Stable, so the context object it goes into is the only thing that changes
   * per render - and `AddonFrame` holds that in a ref rather than in a
   * dependency. A setter rebuilt every render would be a new context every
   * render, which used to mean a new port every render.
   */
  const present = useCallback((next: Card | null) => setCard(next), []);

  return (
    /**
     * Collapsed rather than removed, and the whole card rather than the frame.
     *
     * Three things have to be true at once before the addon has said anything,
     * and only this shape gets all three:
     *
     * - The frame is **mounted**, because the frame is what decides whether
     *   there is a card at all. It cannot wait for one.
     * - It is laid out at its **real width**. This is the part that is easy to
     *   get wrong and was: `display: none` gives the frame no width, so an
     *   addon measuring its own content measures it wrapped one word per line
     *   and asks for a card three times too tall. Hiding the card rather than
     *   skipping it is what keeps the measured width the drawn width.
     * - It is **not reachable**. `visibility: hidden` takes it out of the tab
     *   order, which `height: 0` alone would not.
     */
    <div
      style={
        card
          ? undefined
          : { height: 0, overflow: "hidden", visibility: "hidden" }
      }
    >
      <Widget eyebrow={card?.eyebrow || contribution.name}>
        <AddonFrame
          title={contribution.name}
          manifest={addon.manifest}
          bundle={addon.bundle}
          context={{ kind: "widget", widgetKey: contribution.key, present }}
          style={{
            width: "100%",
            display: "block",
            // Before the addon has asked for a height, the tallest a card may
            // be - so whatever it draws to measure itself is never clipped by
            // the viewport it is measuring in.
            height: card ? card.height : CARD_BOUNDS.max,
          }}
        />
      </Widget>
    </div>
  );
};

/**
 * Every card every installed addon contributes, drawn.
 *
 * Rebuilt per render rather than memoised, exactly like `addonModules`: a
 * handful of objects over a map that changes only when an addon is switched on
 * or off, and a stale list there would be a card that went on drawing after
 * the user disabled it.
 *
 * Disabled and removed both fall out for free. `loadAddons` only ever puts an
 * enabled, unrevoked addon into the store, so an addon switched off is an
 * addon that is not in this map on the next load - the card stops being
 * rendered and its frame is torn down with it.
 *
 * ponytail: appended to the rail rather than ordered through the `widgets`
 * table, which still has no reader. Ordering and enable-per-card is the
 * dashboard editor, and it is a screen, not a line of code. Add it when
 * someone wants to move a card, not because the column exists.
 */
export const AddonWidgets: React.FC = () => (
  <>
    {[...useInstalledAddons().values()].flatMap((addon) =>
      addon.manifest.widgets.map((contribution) => (
        <AddonWidget
          // Namespaced, so two addons contributing `progress` are two cards.
          key={qualify(addon.manifest.id, contribution.key)}
          addon={addon}
          contribution={contribution}
        />
      )),
    )}
  </>
);
