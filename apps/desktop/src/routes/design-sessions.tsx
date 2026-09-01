import { createFileRoute } from "@tanstack/react-router";
import { Button, Card } from "@wiseroutine/design";
import { useEffect, useState } from "react";
import { addonModules } from "../addons/activity-type";
import { loadAddons, useInstalledAddons } from "../addons/installed";
import type { TodaySlot } from "../lib/api";
import {
  ActivityModuleFields,
  type ModuleDraft,
} from "../modules/activity-module-fields";

/**
 * Every session, openable without waiting for a slot.
 *
 * The component gallery lives in the design package and cannot reach these -
 * the modules are the app's, and the design package is a dependency of the app
 * rather than the other way round. So they get their own page, next to it:
 * `pnpm design` then /design-sessions. A sibling of /design rather than a
 * child: that route renders the gallery and no outlet, so a child of it
 * would never appear.
 *
 * Worth having at all because a session is the one thing in this app that is
 * genuinely hard to reach on purpose. Seeing the breathing circle otherwise
 * means configuring an activity, waiting for its slot, and starting it.
 *
 * Installed addons appear here too, and that is the point rather than a
 * convenience: an addon's session runs in a sandboxed frame, and a page that
 * opens one without a sign-in, an activity and a slot is how anyone writing
 * one iterates on it. The app's own breathing pacer is an addon, so without
 * this it would be the least reachable session in the app rather than the
 * most.
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

/** The behaviour fields, against a made-up draft. Reachable in the real app
 *  only behind a sign-in and an open activity sheet. */
const Fields: React.FC = () => {
  const [draft, setDraft] = useState<ModuleDraft>({
    presetKey: "wiseroutine.breathing/pacer",
    sessionEnabled: true,
    startPolicy: "manual",
    configJson: null,
  });

  return (
    <Card
      title="Activity behaviour"
      note="What the sheet shows for a library activity."
    >
      <ActivityModuleFields value={draft} onChange={setDraft} />
    </Card>
  );
};

const Sessions: React.FC = () => {
  const [open, setOpen] = useState<string | null>(null);

  // Loaded here rather than relying on the app shell: this route is a sibling
  // of it, so nothing else on this page would fetch them.
  const installed = useInstalledAddons();
  useEffect(() => {
    void loadAddons();
  }, []);

  const all = addonModules();
  const module = open ? all[open] : undefined;
  const Session = module?.Session;

  return (
    <div style={{ padding: 40, display: "grid", gap: 16, maxWidth: 560 }}>
      <h1 style={{ font: "400 28px var(--font-heading)", margin: 0 }}>
        Sessions
      </h1>
      <p className="wr-body" style={{ margin: 0 }}>
        Each activity module, running against a made-up slot. Stop or finish to
        come back. {installed.size} addon
        {installed.size === 1 ? "" : "s"} installed.
      </p>

      {Object.values(all).map((entry) => (
        <Card key={entry.key} title={entry.name} note={entry.blurb}>
          <Button
            variant="secondary"
            onClick={() => setOpen(entry.key)}
            disabled={!entry.Session}
          >
            {entry.Session ? "Open" : "No session"}
          </Button>
        </Card>
      ))}

      <Fields />

      {Session && module ? (
        <Session
          slot={previewSlot(module.name, module.defaults.sessionMinutes)}
          config={module.defaults.config}
          onDone={() => setOpen(null)}
          onSkip={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/design-sessions")({
  component: Sessions,
});
