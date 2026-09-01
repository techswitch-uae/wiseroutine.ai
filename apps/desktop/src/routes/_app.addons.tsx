import { createFileRoute } from "@tanstack/react-router";
import { type AddonCapability, parseManifest } from "@wiseroutine/addons";
import { Button, Card, Toggle } from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { loadAddons } from "../addons/installed";
import { type AvailableAddon, api, type InstalledAddonRow } from "../lib/api";
import { notify } from "../lib/notify";

/**
 * Addons: the packages, not the cards.
 *
 * The distinction is the reason this is its own page rather than a section of
 * the dashboard editor. You do not reorder an *addon* - you reorder the
 * widgets it contributes, and one addon may contribute several, or none at all
 * and only an activity type. Permissions are granted to the package. Removing
 * is done to the package. The dashboard editor arranges cards; this manages
 * what put them there.
 *
 * ## What the user is actually agreeing to
 *
 * An addon is code somebody outside this repo wrote, running on a machine that
 * holds a calendar. The permission list is therefore the most important thing
 * on the screen, and it is written in sentences rather than in the identifiers
 * the manifest uses: "read today's schedule" is a thing a person can decide
 * about, and `read:schedule` is not.
 *
 * Everything an addon asked for is granted at install, because there is
 * nowhere yet to say "yes to this one, no to that one" - and a checklist that
 * lets you refuse a capability the addon cannot work without is a worse
 * experience than a clear yes or no. `canAddon` already reads the stored grant
 * rather than the manifest, so a partial grant is a change to this screen and
 * to one line on the server, not to the model.
 */

/** A capability, as a sentence someone can decide about. */
function describe(capability: AddonCapability): string {
  switch (capability.kind) {
    case "read:schedule":
      return capability.scope === "today"
        ? "Read today's schedule"
        : `Read your schedule (${capability.scope})`;
    case "write:own":
      return "Add and change its own activities and blocks - never yours";
    case "ui:widget":
      return "Show a card in the rail";
    case "ui:session":
      return "Draw the screen while one of its sessions runs";
    case "net:fetch":
      return `Talk to ${capability.origins.join(", ")}`;
    case "background:wake":
      return "Do a little work when you are not looking at it";
    case "notify":
      return "Send you a notification";
  }
}

const Permissions: React.FC<{ capabilities: readonly AddonCapability[] }> = ({
  capabilities,
}) => {
  if (capabilities.length === 0) {
    return (
      <p className="wr-body" style={{ margin: "8px 0 0" }}>
        Asks for nothing.
      </p>
    );
  }

  return (
    <ul
      className="wr-body"
      style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 2 }}
    >
      {capabilities.map((capability) => (
        <li key={capability.kind + JSON.stringify(capability)}>
          {describe(capability)}
        </li>
      ))}
    </ul>
  );
};

interface Row {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  capabilities: readonly AddonCapability[];
  installed?: InstalledAddonRow;
}

/**
 * The registry and the installed list, joined into one list of things.
 *
 * Two lists side by side - "available" and "installed" - would put an addon in
 * one place before you press a button and another place afterwards, which
 * makes the button feel like it moved the thing away rather than turned it on.
 * One list, with the state on each row.
 */
function rowsOf(
  available: AvailableAddon[],
  installed: InstalledAddonRow[],
): Row[] {
  const byId = new Map(installed.map((row) => [row.id, row]));
  const rows: Row[] = [];

  for (const entry of available) {
    const manifest = parseManifest(entry.manifest);
    if (!manifest) continue;
    rows.push({
      id: entry.id,
      name: manifest.name,
      description: manifest.description,
      author: entry.author,
      version: entry.version,
      capabilities: manifest.capabilities,
      ...(byId.get(entry.id) ? { installed: byId.get(entry.id) } : {}),
    });
    byId.delete(entry.id);
  }

  // Installed but no longer offered - withdrawn from the registry, or listed
  // for a newer version of the app. It is still on this machine and still has
  // to be removable, so it cannot simply be dropped off the screen.
  for (const row of byId.values()) {
    const manifest = parseManifest(row.manifest);
    rows.push({
      id: row.id,
      name: manifest?.name ?? row.id,
      description: manifest?.description ?? "",
      author: "Unknown",
      version: row.version,
      capabilities: manifest?.capabilities ?? [],
      installed: row,
    });
  }

  return rows;
}

const Addons: React.FC = () => {
  const [available, setAvailable] = useState<AvailableAddon[] | null>(null);
  const [installed, setInstalled] = useState<InstalledAddonRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(async () => {
    const [offered, mine] = await Promise.all([
      api.availableAddons().then((r) => r.addons),
      api.installedAddons().then((r) => r.addons),
    ]);
    setAvailable(offered);
    setInstalled(mine);
  }, []);

  useEffect(() => {
    void read().catch(() => setAvailable([]));
  }, [read]);

  /**
   * Every change re-reads the server *and* re-loads the frames.
   *
   * The two are not the same thing: the server knows what is installed, and
   * `loadAddons` is what fetches the bundles and hands them to the host. An
   * addon installed but not loaded is a session that opens empty, and one
   * removed but still loaded is a stranger's code still running.
   */
  const after = useCallback(
    async (work: Promise<unknown>, wrong: string) => {
      try {
        await work;
        await read();
        await loadAddons();
      } catch {
        notify(wrong);
      } finally {
        setBusy(null);
      }
    },
    [read],
  );

  const rows = rowsOf(available ?? [], installed);

  return (
    // The same shape as Calendars and Settings: a full-width scroller so its
    // bar sits at the page edge, with the reading measure as a column inside.
    <div className="wr-page-scroll">
      <div className="wr-measure">
        <h2 className="wr-settings-title">Addons</h2>

        <p className="wr-body" style={{ margin: "0 0 22px" }}>
          Addons are written by other people and reviewed before they appear
          here. Each one says what it needs, and can do nothing else.
        </p>

        <div style={{ display: "grid", gap: 14 }}>
          {available === null ? (
            <p className="wr-body">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="wr-body">
              Nothing to install yet. Addons appear here once they have been
              reviewed.
            </p>
          ) : null}

          {rows.map((row) => (
            <Card
              key={row.id}
              title={row.name}
              note={`${row.author} · ${row.version}`}
            >
              <p className="wr-body" style={{ margin: 0 }}>
                {row.description}
              </p>

              {row.installed?.revoked ? (
                // Withdrawn after it was installed. Said plainly rather than
                // dressed up: this is the one case where the app overrides a
                // choice the user made, and they are entitled to know.
                <p
                  className="wr-body"
                  style={{ margin: "8px 0 0", fontWeight: 600 }}
                >
                  Withdrawn from the registry. It has stopped running; remove it
                  when convenient.
                </p>
              ) : null}

              <Permissions capabilities={row.capabilities} />

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  marginTop: 12,
                }}
              >
                {row.installed ? (
                  <>
                    <Toggle
                      label={`${row.name} on`}
                      checked={row.installed.isEnabled}
                      onChange={(next) => {
                        if (busy) return;
                        setBusy(row.id);
                        void after(
                          api.setAddonEnabled(row.id, next),
                          "Couldn't change that just now.",
                        );
                      }}
                    />
                    <Button
                      variant="quiet"
                      disabled={busy === row.id}
                      onClick={() => {
                        setBusy(row.id);
                        void after(
                          api.removeAddon(row.id),
                          "Couldn't remove that just now.",
                        );
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy === row.id}
                    onClick={() => {
                      setBusy(row.id);
                      void after(
                        api.installAddon(row.id),
                        "Couldn't install that just now.",
                      );
                    }}
                  >
                    Install
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_app/addons")({ component: Addons });
