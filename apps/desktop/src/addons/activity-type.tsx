import {
  type AddonActivityType,
  defaultConfig,
  ownerOf,
  parseConfig,
  qualify,
} from "@wiseroutine/addons";
import { SelectField } from "@wiseroutine/design";
import type { ActivityModule } from "../modules/activities";
import { SessionFrame } from "../modules/activities/session-chrome";
import { useEndsAt } from "../modules/activities/session-clock";
import { AddonFrame } from "./frame";
import { type InstalledAddon, installedAddons } from "./installed";

/**
 * An addon's activity type, wearing the interface a built-in one wears.
 *
 * `moduleFor` is the only seam this needed. Everything that consults a module -
 * the session overlay, the activity sheet, the Start button's explanation, the
 * library - goes on calling it and gets back the same shape, so none of them
 * learned that addons exist. That was the whole reason to keep `ActivityModule`
 * as it was rather than growing a second kind of module beside it.
 *
 * ## What the host keeps
 *
 * `SessionFrame` is drawn here, not by the addon. It owns the title, the Done
 * and Stop buttons, the chime and `role="dialog"`, and an addon can neither
 * draw them nor suppress them. A full-window takeover whose exit button
 * belonged to the addon would be an exit button the addon could fake or refuse
 * to honour, and a session is exactly the moment a user has to be able to
 * leave.
 *
 * `useEndsAt` is here for the same reason: when the session's time runs out
 * the slot is completed, and whether a session ended is a fact about the
 * user's day rather than a courtesy the addon performs.
 *
 * The addon draws the inside. That is all it draws.
 *
 * ## What the host can do without running the addon
 *
 * `parse` is `parseConfig` against the settings schema in the manifest, and
 * `Config` is a form the host renders from that same schema with the app's own
 * fields. Both matter more than they look: a built-in module supplies its own
 * `parse` function and the app calls it, which is fine for four modules in
 * this repo and not fine for code a stranger wrote. Reading and writing an
 * addon's settings never executes a line of it.
 */

/**
 * The canvas an addon gets inside a session.
 *
 * Fixed, and the same for every addon. An iframe has no intrinsic height, so
 * something has to say - and letting the addon say would let it grow until it
 * covered the Done button. Sized to the app's own breathing pacer, which is
 * the widest thing a session has needed.
 */
const CANVAS = {
  width: 360,
  height: 400,
  /**
   * `SessionFrame` is a flex column, and a flex item shrinks by default. On a
   * short window the frame was squeezed from 400 to 255 and the addon's lower
   * half - its progress bar and its "3 min left" - was simply cut off, with
   * nothing to say so. An iframe has no intrinsic height to fall back on, so
   * the shrink has to be refused rather than negotiated.
   */
  flexShrink: 0,
} as const;

function sessionFor(
  addon: InstalledAddon,
  type: AddonActivityType,
): React.FC<{
  slot: { startsAt: number; endsAt: number; id: string; title: string };
  config: unknown;
  onDone: () => void;
  onSkip: () => void;
}> {
  return ({ slot, config, onDone, onSkip }) => {
    // The host's clock, not the addon's. See the note at the top.
    useEndsAt(slot.endsAt, onDone);

    return (
      <SessionFrame
        dim={type.ground === "dim"}
        title={type.name}
        doneLabel="Done early"
        onDone={onDone}
        onSkip={onSkip}
        meter={
          <AddonFrame
            title={type.name}
            manifest={addon.manifest}
            bundle={addon.bundle}
            context={{
              kind: "session",
              // Only the four fields the SDK publishes. The app's own slot
              // also carries a lock flag, a conflict id and the module key,
              // and an addon has no business with any of them.
              slot: {
                id: slot.id,
                title: slot.title,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
              },
              config,
            }}
            style={CANVAS}
          />
        }
      />
    );
  };
}

function configFormFor(
  type: AddonActivityType,
): React.FC<{ value: unknown; onChange: (next: unknown) => void }> {
  return ({ value, onChange }) => {
    const config = parseConfig(type, value);

    return (
      <>
        {type.settings.map((field) => {
          const current = config[field.key];
          switch (field.type) {
            case "select":
              return (
                <SelectField
                  key={field.key}
                  label={field.label}
                  options={[...field.options]}
                  value={String(current)}
                  onChange={(event) =>
                    onChange({ ...config, [field.key]: event.target.value })
                  }
                />
              );
            // ponytail: `number` and `text` are in the published schema and
            // have no field drawn for them yet, because no addon declares one.
            // A field the host cannot draw is skipped rather than guessed at -
            // the stored value keeps its default and nothing lies about it.
            default:
              return null;
          }
        })}
      </>
    );
  };
}

/**
 * Every activity type every installed addon defines, as modules.
 *
 * Rebuilt per call rather than memoised: it is a handful of objects over a
 * map that changes only when an addon is installed, and a stale registry after
 * an install would be a session that could not open.
 */
export function addonModules(): Record<string, ActivityModule> {
  const modules: Record<string, ActivityModule> = {};

  for (const addon of installedAddons().values()) {
    for (const type of addon.manifest.activityTypes) {
      const key = qualify(addon.manifest.id, type.key);
      modules[key] = {
        key,
        name: type.name,
        blurb: type.blurb,
        defaults: {
          sessionMinutes: type.defaults.sessionMinutes,
          startPolicy: type.defaults.startPolicy,
          config: defaultConfig(type),
        },
        parse: (raw) => parseConfig(type, raw),
        Config: configFormFor(type),
        Session: sessionFor(addon, type),
      } as ActivityModule;
    }
  }

  return modules;
}

/** The module for a key belonging to an addon, if that addon is installed. */
export function addonModuleFor(key: string): ActivityModule | undefined {
  if (ownerOf(key) === null) return undefined;
  return addonModules()[key];
}
