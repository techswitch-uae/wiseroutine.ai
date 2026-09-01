import { addonModuleFor, addonModules } from "../../addons/activity-type";
import type { TodaySlot } from "../../lib/api";

/**
 * What an activity does when its slot is running.
 *
 * Every one of them is an addon now, including the four Wise Routine ships.
 * There is no built-in table left and no first-party shortcut into this
 * lookup - `moduleFor` asks the installed addons and nothing else.
 *
 * That is the whole point, and it cost four files to get: an extension point
 * the app itself does not use is an extension point nobody maintains. The
 * breathing pacer, the eye rest, the guided stretch and the deep work block
 * are loaded from a registry, sandboxed in a frame with an opaque origin,
 * hold exactly the capabilities their manifests declare, and are switched off
 * by the same toggle a stranger's addon will be. When somebody outside this
 * repo writes their first one, the path it takes has been in production for
 * months.
 *
 * `ActivityModule` survives as the *internal* shape a running session wears,
 * which is why the rename left it alone: everything that consults a module -
 * the session overlay, the activity sheet, the Start button's explanation, the
 * library - goes on calling `moduleFor` and gets back this, so none of them
 * ever learned that addons exist.
 *
 * Kept deliberately small. `Config` renders inside the existing activity form;
 * `Session` is the full-window takeover a running slot puts on screen. Both
 * are optional, because an activity with a module but no session - a walk,
 * say - is a real thing and should not have to supply an empty component.
 *
 * `config` is `unknown` on the way in and parsed against the addon's declared
 * settings schema. The server stores it as opaque JSON text and never looks
 * inside; the host reads it without executing a line of the addon.
 */

export type StartPolicy = "manual" | "auto" | "prompt";

export interface SessionProps<C> {
  slot: TodaySlot;
  config: C;
  /** Finished it. Completes the slot. */
  onDone: () => void;
  /** Stopped without finishing. Skips the slot, honestly. */
  onSkip: () => void;
}

export interface ConfigProps<C> {
  value: C;
  onChange: (next: C) => void;
}

export interface ActivityModule<C = unknown> {
  key: string;
  name: string;
  /**
   * What the session does, as a clause that finishes "When this is on, ...".
   *
   * A clause rather than a sentence because it is always on screen next to
   * the switch, in a sentence that also says what happens when it is off.
   * Someone deciding needs both halves at once - a description that only
   * appears once the switch is already on tells them what they have just
   * done, not what they were choosing.
   */
  blurb: string;
  defaults: {
    sessionMinutes: number;
    startPolicy: StartPolicy;
    config: C;
  };
  /** Turn whatever was stored into something this module can render. Must
   *  never throw: a config written by an older version of the addon is a
   *  thing that happens, and a crash in a session is worse than a default. */
  parse: (raw: unknown) => C;
  Config?: React.FC<ConfigProps<C>>;
  Session?: React.FC<SessionProps<C>>;
}

/**
 * Every activity type every enabled addon defines.
 *
 * Named `MODULES` no longer, because it is not a table anyone edits - it is a
 * view over what is installed, and it changes when an addon is switched on or
 * off. Callers that want one key should use `moduleFor`; this is for the two
 * places that genuinely need the whole set, both of them galleries.
 */
export const allModules = (): Record<string, ActivityModule> => addonModules();

/**
 * The module a slot runs under, or undefined for a plain timed slot.
 *
 * Undefined for a key nobody claims, which is a real and permanent state
 * rather than an error: an addon can be switched off or removed while the
 * activities it ran are still on the day, and those have to keep running as
 * plain timed blocks. Everything downstream already draws nothing for a key it
 * does not recognise, which is what makes an uninstall safe.
 */
export const moduleFor = (
  presetKey: string | null | undefined,
): ActivityModule | undefined =>
  presetKey ? addonModuleFor(presetKey) : undefined;

/**
 * The stored settings, as the module wants them.
 *
 * Parsing failures are settings, not errors: an activity configured by a newer
 * version of an addon, or by hand, still has to run. Every `parse` falls back
 * to the schema's own defaults rather than throwing.
 */
export function configFor(
  /**
   * Only the two members this reads.
   *
   * `ActivityModule<unknown>` would not do: `Config` takes its config as a
   * prop, so a module typed against a concrete shape is not assignable to one
   * typed against `unknown`. Naming what is actually used sidesteps that
   * without an assertion, and says plainly that parsing needs no components.
   */
  module: Pick<ActivityModule<unknown>, "parse" | "defaults">,
  configJson: string | null | undefined,
): unknown {
  if (!configJson) return module.defaults.config;
  try {
    return module.parse(JSON.parse(configJson));
  } catch {
    return module.defaults.config;
  }
}
