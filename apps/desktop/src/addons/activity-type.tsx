import {
  type AddonActivityType,
  canvasFor,
  defaultConfig,
  ownerOf,
  parseConfig,
  qualify,
} from "@wiseroutine/addons";
import type { ActivityModule } from "../modules/activities";
import { SessionFrame } from "../modules/activities/session-chrome";
import { useEndsAt } from "../modules/activities/session-clock";
import { AddonFrame } from "./frame";
import { type InstalledAddon, installedAddons } from "./installed";
import { SettingsFields } from "./settings-fields";

/**
 * An addon's activity type, wearing the interface a built-in one wears.
 *
 * `moduleFor` is the only seam. Everything that consults a module gets the
 * same shape and never learned that addons exist.
 *
 * The host keeps the frame around a session: `SessionFrame` owns the title,
 * Done and Stop, the chime and `role="dialog"`. `useEndsAt` completes the
 * slot when time runs out. The addon draws the inside and nothing else.
 *
 * `parse` and `Config` come from the settings schema in the manifest, so
 * reading or editing an addon's settings never runs the addon.
 */

/** Asked for by the manifest, clamped by `canvasFor`. `flexShrink: 0`
 *  because a flex item shrinks by default and an iframe has no height of
 *  its own to fall back on. */
const canvasStyle = (type: AddonActivityType): React.CSSProperties => ({
  ...canvasFor(type),
  maxWidth: "100%",
  flexShrink: 0,
});

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
    // The host's clock, not the addon's.
    useEndsAt(slot.endsAt, onDone);

    return (
      <SessionFrame
        dim={type.ground === "dim"}
        // The activity's name, not the type's: "Thesis", not "Deep work".
        title={slot.title || type.name}
        doneLabel="Done early"
        onDone={onDone}
        onSkip={onSkip}
        meter={
          <AddonFrame
            title={type.name}
            addon={addon}
            context={{
              kind: "session",
              // Only the four fields the SDK publishes.
              slot: {
                id: slot.id,
                title: slot.title,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
              },
              config,
              finish: onDone,
            }}
            style={canvasStyle(type)}
          />
        }
      />
    );
  };
}

function configFormFor(
  type: AddonActivityType,
): React.FC<{ value: unknown; onChange: (next: unknown) => void }> {
  return ({ value, onChange }) => (
    <SettingsFields
      fields={type.settings}
      value={parseConfig(type, value)}
      onChange={onChange}
    />
  );
}

/** Every activity type every installed addon defines, as modules. Rebuilt
 *  per call: the map changes when an addon is installed. */
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

/** Every activity type, with the schema it declared. For the preview
 *  gallery, which enumerates a session's variants. */
export function addonActivityTypes(): {
  key: string;
  addonId: string;
  type: AddonActivityType;
}[] {
  const types: { key: string; addonId: string; type: AddonActivityType }[] = [];

  for (const addon of installedAddons().values()) {
    for (const type of addon.manifest.activityTypes) {
      types.push({
        key: qualify(addon.manifest.id, type.key),
        addonId: addon.manifest.id,
        type,
      });
    }
  }

  return types;
}

/** The module for a key belonging to an addon, if that addon is installed. */
export function addonModuleFor(key: string): ActivityModule | undefined {
  if (ownerOf(key) === null) return undefined;
  return addonModules()[key];
}
