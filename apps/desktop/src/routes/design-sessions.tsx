import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { defaultConfig, type SettingField } from "@wiseroutine/addons";
import { Button, Card } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { addonActivityTypes, addonModules } from "../addons/activity-type";
import { loadAddons, useInstalledAddons } from "../addons/installed";
import type { TodaySlot } from "../lib/api";
import {
  ActivityModuleFields,
  type ModuleDraft,
} from "../modules/activity-module-fields";

/**
 * Every session, and every variant of it, openable without waiting for a slot.
 *
 * The component gallery lives in the design package and cannot reach these -
 * the sessions are addons, and the design package is a dependency of the app
 * rather than the other way round. So they get their own page, next to it:
 * `pnpm design` then /design-sessions. A sibling of /design rather than a
 * child: that route renders the gallery and no outlet, so a child of it would
 * never appear.
 *
 * Worth having at all because a session is the one thing in this app that is
 * genuinely hard to reach on purpose. Seeing the breathing circle otherwise
 * means configuring an activity, waiting for its slot, and starting it - and
 * seeing the *4-7-8* one means doing that and then editing a setting.
 *
 * ## Variants, read from the manifest
 *
 * Every option of every `select` a session declares gets its own entry. So the
 * three stretch routines and the three breathing patterns are each one press,
 * and none of them is listed here by name - this file has no table of patterns
 * to fall out of date. An addon that adds a fourth pattern tomorrow appears
 * here with four, and one that declares no options at all appears once.
 *
 * Only `select` is enumerated, which is the honest limit: an option list is
 * finite and a number field is not. Number and text settings show at their
 * defaults, and the form at the bottom of the page is how you try other values.
 *
 * ## Why it is a route with parameters
 *
 * The open session and its settings live in the URL, so a particular variant
 * is a link: paste it, reload it, or send it to whoever is reviewing the
 * addon, and the same screen comes back. Somebody iterating on a pacer reloads
 * that URL a hundred times, and having to re-pick the pattern each time is the
 * difference between a tool and a demo.
 */

const previewSlot = (title: string, minutes: number): TodaySlot => ({
  id: "preview",
  title,
  kind: "recovery",
  // From now, so every countdown in here reads like a real one.
  startsAt: Date.now(),
  endsAt: Date.now() + minutes * 60_000,
  status: "started",
  isLocked: false,
  conflictEventId: null,
});

interface Variant {
  /** The activity type this runs, as `addonId/typeKey`. */
  key: string;
  name: string;
  blurb: string;
  /** What makes this one different, or null for the plain default. */
  label: string | null;
  config: Record<string, unknown>;
}

const selects = (settings: readonly SettingField[]) =>
  settings.filter((field) => field.type === "select");

/**
 * One entry per session, plus one per option of every choice it offers.
 *
 * One field at a time rather than the cross product. Two selects of three
 * options each is nine screens nobody wants to scroll past, and the thing
 * being previewed is a single setting's effect - which is exactly what varying
 * one at a time shows.
 */
function variantsOf(): Variant[] {
  const modules = addonModules();
  const out: Variant[] = [];

  for (const { key, type } of addonActivityTypes()) {
    const module = modules[key];
    if (!module) continue;

    const base = defaultConfig(type);
    const choices = selects(type.settings);

    if (choices.length === 0) {
      out.push({
        key,
        name: type.name,
        blurb: type.blurb,
        label: null,
        config: base,
      });
      continue;
    }

    for (const field of choices) {
      for (const option of field.options) {
        out.push({
          key,
          name: type.name,
          blurb: type.blurb,
          // The value alone, not "Pattern: box 4-4-4-4". The field's label
          // repeats for every option under it and the option is the only part
          // that changes.
          label: option,
          config: { ...base, [field.key]: option },
        });
      }
    }
  }

  return out;
}

/** The behaviour fields, against a made-up draft. Reachable in the real app
 *  only behind a sign-in and an open activity sheet. */
const Fields: React.FC<{ presetKey: string | null }> = ({ presetKey }) => {
  const [draft, setDraft] = useState<ModuleDraft>({
    presetKey,
    sessionEnabled: true,
    startPolicy: "manual",
    configJson: null,
  });

  if (!draft.presetKey) return null;

  return (
    <Card
      title="Activity behaviour"
      note="What the activity sheet shows, including the settings this addon declared."
    >
      {/* The same wrapper the real sheet puts these in. Without it the fields
          have no spacing at all - `.wr-field` is a plain block and the 20px
          between them comes from `.wr-activity-form`'s grid gap - so the
          gallery was showing a cramped version of a form that is fine in the
          app, which is the one thing a gallery must not do. */}
      <div className="wr-activity-form">
        <ActivityModuleFields value={draft} onChange={setDraft} />
      </div>
    </Card>
  );
};

interface Search {
  /** The activity type to open, as `addonId/typeKey`. */
  open?: string;
  /**
   * Its settings. Absent means the addon's own defaults.
   *
   * An object, not a JSON string, because the router serialises search values
   * itself. Handing it a string it had already been asked to encode produced
   * `config="{\"routine\":\"…\"}"` - JSON inside JSON - and reading it back
   * with `JSON.parse` then threw on the object the router had helpfully
   * decoded, so every link silently opened at the defaults.
   */
  config?: Record<string, unknown>;
}

const Sessions: React.FC = () => {
  const { open, config } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Loaded here rather than relying on the app shell: this route is a sibling
  // of it, so nothing else on this page would fetch them.
  const installed = useInstalledAddons();
  useEffect(() => {
    void loadAddons();
  }, []);

  const variants = variantsOf();
  const module = open ? addonModules()[open] : undefined;
  const Session = module?.Session;

  const show = (variant: Variant) =>
    void navigate({ search: { open: variant.key, config: variant.config } });

  // Cleared through the URL like everything else, so the back button and the
  // Stop button end up in the same place.
  const close = () => void navigate({ search: {} });

  /**
   * Whatever the URL said, put through the addon's own `parse`.
   *
   * A URL is typed by a person, so this may be anything at all. `parse` is
   * `parseConfig` against the addon's declared schema: it never throws, it
   * drops what the schema does not name, and a value outside a field's options
   * falls back to that field's default. So a hand-edited link opens the
   * session rather than breaking it.
   */
  const parsed = module?.parse(config);

  return (
    <div style={{ padding: 40, display: "grid", gap: 16, maxWidth: 560 }}>
      <h1 style={{ font: "400 28px var(--font-heading)", margin: 0 }}>
        Sessions
      </h1>
      <p className="wr-body" style={{ margin: 0 }}>
        Every session an installed addon defines, and every option it offers,
        running against a made-up slot. Stop or finish to come back. Each one is
        a link, so a particular variant can be reloaded or sent on.{" "}
        {installed.size} addon
        {installed.size === 1 ? "" : "s"} installed.
      </p>

      {installed.size === 0 ? (
        <p className="wr-body">
          Nothing installed. Sign in and open Addons, or run each addon's build
          so its bundle is where the app can fetch it.
        </p>
      ) : null}

      {/* Grouped by session, so the three patterns of one sit together rather
          than being four cards that happen to share a name. */}
      {[...new Set(variants.map((variant) => variant.key))].map((key) => {
        const mine = variants.filter((variant) => variant.key === key);
        const first = mine[0];
        if (!first) return null;

        return (
          <Card key={key} title={first.name} note={first.blurb}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {mine.map((variant) => (
                <Button
                  key={variant.label ?? "default"}
                  variant="secondary"
                  onClick={() => show(variant)}
                >
                  {variant.label ?? "Open"}
                </Button>
              ))}
            </div>
          </Card>
        );
      })}

      {/* Keyed, so it is rebuilt once the addons finish loading.
          `useState` reads its initial value on the first render only, and on
          that render nothing is installed yet - the fetch is in an effect - so
          the card mounted with no preset key and stayed that way for ever. */}
      <Fields
        key={variants[0]?.key ?? "none"}
        presetKey={variants[0]?.key ?? null}
      />

      {Session && module ? (
        <Session
          // Keyed by the whole URL state, so pressing a second variant while
          // one is open tears the frame down and builds a new one. An addon
          // reads its config once, at connect, and would otherwise go on
          // pacing the pattern it was opened with.
          key={`${open}:${JSON.stringify(config ?? {})}`}
          slot={previewSlot(module.name, module.defaults.sessionMinutes)}
          config={parsed}
          onDone={close}
          onSkip={close}
        />
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/design-sessions")({
  component: Sessions,
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.open === "string" ? { open: search.open } : {}),
    // Only that it is an object. What is *in* it is the addon's business, and
    // `parseConfig` is what decides that - here or anywhere else the column is
    // read. Two places deciding what a valid config looks like is one too many.
    ...(typeof search.config === "object" &&
    search.config !== null &&
    !Array.isArray(search.config)
      ? { config: search.config as Record<string, unknown> }
      : {}),
  }),
});
