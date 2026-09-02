import { AddonFrame } from "./frame";
import { useInstalledAddons } from "./installed";

/**
 * Hidden frames for addons that need to be running without a card.
 *
 * Given to every enabled addon that contributes a `quickAdd` row or holds
 * `background:wake`. Quick add requests go here first, so an addon without
 * a widget can still keep what was typed. The frame is `hidden`: it runs,
 * draws nothing, and is torn down when the addon is switched off.
 */
export const AddonBackground: React.FC = () => (
  <>
    {[...useInstalledAddons().values()]
      .filter(
        (addon) =>
          addon.manifest.quickAdd.length > 0 ||
          addon.granted.some((c) => c.kind === "background:wake"),
      )
      .map((addon) => (
        <div key={addon.manifest.id} hidden>
          <AddonFrame
            title={`${addon.manifest.name} (background)`}
            addon={addon}
            context={{ kind: "background" }}
          />
        </div>
      ))}
  </>
);
