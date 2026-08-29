import type { TodaySlot } from "../../lib/api";
import { breathing } from "./breathing";
import { deepWork } from "./deep-work";
import { eyeRest } from "./eye-rest";
import { stretch } from "./stretch";

/**
 * What an activity does when its slot is running.
 *
 * A plain object keyed by string, not a plugin system. Every benefit of one -
 * a per-activity experience, a settings form that belongs to the module rather
 * than to the activity sheet, room for a marketplace later - falls out of a
 * typed record, and none of the cost does: no loader, no manifest, no version
 * negotiation, no sandbox, and nothing to secure. A new module is a file and
 * one line here.
 *
 * Kept deliberately small. `Config` renders inside the existing activity form;
 * `Session` is the full-window takeover a running slot puts on screen. Both
 * are optional, because an activity with a module but no session - a walk,
 * say - is a real thing and should not have to supply an empty component.
 *
 * `config` is `unknown` on the way in and parsed by the module itself. The
 * server stores it as opaque JSON text and never looks inside, so the module
 * that wrote it is the only thing that knows its shape, and the only thing
 * that should.
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
  /** One line, shown where a module is chosen. */
  blurb: string;
  defaults: {
    sessionMinutes: number;
    startPolicy: StartPolicy;
    config: C;
  };
  /** Turn whatever was stored into something this module can render. Must
   *  never throw: a config written by an older version of the module is a
   *  thing that happens, and a crash in a session is worse than a default. */
  parse: (raw: unknown) => C;
  Config?: React.FC<ConfigProps<C>>;
  Session?: React.FC<SessionProps<C>>;
}

// Each module is typed against its own config; the registry is the one place
// those types are erased, and the alternative is a generic parameter threaded
// through every lookup site for no reader's benefit.
// biome-ignore lint/suspicious/noExplicitAny: erased on purpose, see above
export const MODULES: Record<string, ActivityModule<any>> = {
  [eyeRest.key]: eyeRest,
  [breathing.key]: breathing,
  [stretch.key]: stretch,
  [deepWork.key]: deepWork,
};

/** The module a slot runs under, or undefined for a plain timed slot. */
export const moduleFor = (
  presetKey: string | null | undefined,
): ActivityModule | undefined => (presetKey ? MODULES[presetKey] : undefined);

/**
 * The stored settings, as the module wants them.
 *
 * Parsing failures are settings, not errors: an activity configured by a
 * newer version of the app, or by hand, still has to run. Every module's
 * `parse` falls back to its own defaults rather than throwing.
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
