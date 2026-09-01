import {
  type AddonActivityType,
  canvasFor,
  defaultConfig,
  ownerOf,
  parseConfig,
  qualify,
} from "@wiseroutine/addons";
import { Field, SelectField } from "@wiseroutine/design";
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
 * Asked for by the manifest and clamped by `canvasFor`, rather than fixed for
 * everyone. One size for all of them meant a breathing circle and a four-line
 * stretch instruction got the same square; the clamp is what stops the other
 * extreme, because an addon that could size its own frame could grow it until
 * it covered the Done button - the one control a session must never be able
 * to take away.
 *
 * `flexShrink: 0` is not decoration. `SessionFrame` is a flex column and a
 * flex item shrinks by default, so on a short window the frame was squeezed
 * from 400 to 255 and the addon's lower half was cut off with nothing to say
 * so. An iframe has no intrinsic height to fall back on, so the shrink has to
 * be refused rather than negotiated.
 */
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
    // The host's clock, not the addon's. See the note at the top.
    useEndsAt(slot.endsAt, onDone);

    return (
      <SessionFrame
        dim={type.ground === "dim"}
        // The activity's name, not the activity type's. Someone who called
        // their focus block "Thesis" is looking at a session about the thesis,
        // and being told it is "Deep work" is being told something they
        // already decided not to call it.
        title={slot.title || type.name}
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
            /**
             * Both drawn with the app's own `Field`, which is an `<input>`
             * with the app's label and pill. No new component for either:
             * `number` is that input with `type="number"`, and inventing a
             * `NumberField` beside it would be a second thing to keep in step
             * with the first for no reader's benefit.
             */
            case "number":
              return (
                <Field
                  key={field.key}
                  type="number"
                  label={field.label}
                  value={String(current)}
                  {...(field.min !== undefined ? { min: field.min } : {})}
                  {...(field.max !== undefined ? { max: field.max } : {})}
                  onChange={(event) => {
                    /**
                     * Clamped on the way in, not only on the way out.
                     *
                     * The input's own `min` and `max` guard the arrows and
                     * nothing else - a typed 999 sails past them. Stored as
                     * typed, `parseConfig` would reject it on the next read
                     * and fall back to the default, so the field would appear
                     * to forget what was put into it. An empty field is not a
                     * number at all and holds the default rather than storing
                     * NaN, which the same fallback would silently erase.
                     */
                    const typed = Number(event.target.value);
                    const next = Number.isFinite(typed) ? typed : field.default;
                    onChange({
                      ...config,
                      [field.key]: Math.min(
                        field.max ?? Number.POSITIVE_INFINITY,
                        Math.max(field.min ?? Number.NEGATIVE_INFINITY, next),
                      ),
                    });
                  }}
                />
              );
            case "text":
              return (
                <Field
                  key={field.key}
                  label={field.label}
                  value={String(current)}
                  {...(field.placeholder
                    ? { placeholder: field.placeholder }
                    : {})}
                  onChange={(event) =>
                    onChange({
                      ...config,
                      // Truncated rather than refused. Someone pasting a long
                      // URL should find the field stops taking characters,
                      // not lose the paste with no explanation.
                      [field.key]: event.target.value.slice(
                        0,
                        field.maxLength ?? 500,
                      ),
                    })
                  }
                />
              );
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

/**
 * Every activity type, with the schema it declared.
 *
 * `ActivityModule` deliberately does not carry the settings schema - nothing
 * in the app needs it, because `parse` and `Config` are built from it here and
 * the rest of the app only ever uses those. The preview gallery is the one
 * exception: it enumerates a session's variants, and to do that it has to read
 * what the variants *are* rather than be told about them.
 *
 * Returned rather than exposed on the module, so the extra surface exists for
 * the one caller that needs it instead of for everything that touches a
 * module.
 */
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
