import { createFileRoute } from "@tanstack/react-router";
import {
  type AddonCapability,
  type AddonManifest,
  parseCapabilities,
  parseConfig,
  parseManifest,
  ungranted,
} from "@wiseroutine/addons";
import { Button, Card, Modal, Toggle } from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { forgetAddon, loadAddons } from "../addons/installed";
import { SettingsFields } from "../addons/settings-fields";
import {
  type AddonImpact,
  type AvailableAddon,
  api,
  type InstalledAddonRow,
} from "../lib/api";
import { notify } from "../lib/notify";

/**
 * Addons: the packages, not the cards.
 *
 * Permissions are granted to the package and written as sentences a person
 * can decide about. A fresh install grants everything the addon asks for.
 * When a new version asks for more, the extra capabilities are listed with
 * an Allow button and stay off until pressed.
 *
 * Bundled addons have a switch. Community addons have Install and Remove.
 * Switching off pauses the activities that run on the addon, after showing
 * which ones; switching on restores them.
 *
 * An addon's own settings are edited here. Secret fields are stored on this
 * device through Rust and never sent to the server.
 */

/** A capability, as a sentence someone can decide about. */
function describe(capability: AddonCapability): string {
  switch (capability.kind) {
    case "read:schedule":
      return capability.scope === "today"
        ? "Read today's schedule"
        : `Read your schedule (${capability.scope})`;
    case "write:own":
      return "Place blocks of its own on your day, and finish or skip them - never yours";
    case "ui:widget":
      return "Show a card in the rail";
    case "ui:session":
      return "Draw the screen while one of its sessions runs";
    case "net:fetch":
      return capability.auth
        ? `Talk to ${capability.origins.join(", ")}, signed with a key you enter here`
        : `Talk to ${capability.origins.join(", ")}`;
    case "ui:embed":
      return `Show a page from ${capability.origins.join(", ")} inside the app`;
    case "open:external":
      return `Open ${capability.origins.join(", ")} in your browser`;
    case "background:wake":
      return "Keep running in the background while the app is open";
    case "notify":
      return "Send you notifications, labelled with its name";
    case "read:todos":
      return "See your todos";
    case "write:todos":
      return "Add, finish and drop todos, and put them on your day";
  }
}

const Permissions: React.FC<{
  title?: string;
  capabilities: readonly AddonCapability[];
}> = ({ title, capabilities }) => {
  if (capabilities.length === 0) {
    return (
      <p className="wr-body" style={{ margin: "8px 0 0" }}>
        Asks for nothing.
      </p>
    );
  }

  return (
    <>
      {title ? (
        <p className="wr-body" style={{ margin: "8px 0 0", fontWeight: 600 }}>
          {title}
        </p>
      ) : null}
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
    </>
  );
};

const inTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

/** Which secret fields hold a value on this device, and a way to set one. */
function useSecrets(id: string, fields: AddonManifest["settings"]) {
  const wanted = fields.some((f) => f.type === "secret");
  const [present, setPresent] = useState<string[]>([]);

  const read = useCallback(async () => {
    if (!wanted || !inTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    setPresent(await invoke<string[]>("addon_secret_keys", { id }));
  }, [id, wanted]);

  useEffect(() => {
    void read().catch(() => undefined);
  }, [read]);

  const set = async (key: string, value: string) => {
    if (!inTauri()) {
      notify("Keys can only be saved in the desktop app.");
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_addon_secret", { id, key, value });
    await read();
  };

  return { present, set, available: wanted && inTauri() };
}

/** An installed addon's own settings, with a Save button. */
const AddonSettings: React.FC<{
  id: string;
  manifest: AddonManifest;
  stored: unknown;
  onSaved: () => Promise<void>;
}> = ({ id, manifest, stored, onSaved }) => {
  const [value, setValue] = useState(() => parseConfig(manifest, stored));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const secrets = useSecrets(id, manifest.settings);
  const [pending, setPending] = useState<Record<string, string>>({});

  const save = async () => {
    setSaving(true);
    try {
      await api.setAddonSettings(id, value);
      for (const [key, secret] of Object.entries(pending)) {
        await secrets.set(key, secret);
      }
      setPending({});
      setDirty(false);
      await onSaved();
    } catch {
      notify("Couldn't save those settings just now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <SettingsFields
        fields={manifest.settings}
        value={value}
        onChange={(next) => {
          setValue(next);
          setDirty(true);
        }}
        secrets={{
          present: secrets.present,
          set: (key, secret) => {
            setPending((p) => ({ ...p, [key]: secret }));
            setDirty(true);
          },
        }}
      />
      {!secrets.available &&
      manifest.settings.some((f) => f.type === "secret") ? (
        <p className="wr-body" style={{ margin: 0, opacity: 0.7 }}>
          Keys can only be entered in the desktop app.
        </p>
      ) : null}
      <div>
        <Button
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          Save settings
        </Button>
      </div>
    </div>
  );
};

interface Row {
  id: string;
  manifest: AddonManifest | null;
  name: string;
  description: string;
  author: string;
  version: string;
  capabilities: readonly AddonCapability[];
  installed?: InstalledAddonRow;
}

/** The registry and the installed list, joined into one list. */
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
      manifest,
      name: manifest.name,
      description: manifest.description,
      author: entry.author,
      version: entry.version,
      capabilities: manifest.capabilities,
      ...(byId.get(entry.id) ? { installed: byId.get(entry.id) } : {}),
    });
    byId.delete(entry.id);
  }

  // Installed but no longer offered. Still on this machine, still removable.
  for (const row of byId.values()) {
    const manifest = parseManifest(row.manifest);
    rows.push({
      id: row.id,
      manifest,
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

/** The grant as stored, or empty when it cannot be read. */
const grantOf = (row: InstalledAddonRow): AddonCapability[] =>
  parseCapabilities(row.granted) ?? [];

/** What the user is being asked to agree to, with the answer still pending. */
interface Asking {
  row: Row;
  impact: AddonImpact;
  kind: "disable" | "remove";
}

const count = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

function consequence(asking: Asking): string {
  const { activities, futureSlots } = asking.impact;
  const named = activities.map((activity) => activity.name).join(", ");
  const slots =
    futureSlots > 0
      ? `, and ${count(futureSlots, "block", "blocks")} still ahead on your day will come off it`
      : "";

  return `${named} ${activities.length === 1 ? "runs" : "run"} on this addon, so ${activities.length === 1 ? "it" : "they"} will be paused${slots}. Anything already done stays done.`;
}

const Addons: React.FC = () => {
  const [available, setAvailable] = useState<AvailableAddon[] | null>(null);
  const [installed, setInstalled] = useState<InstalledAddonRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);

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

  /** Every change re-reads the server and re-loads the frames. */
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
        setAsking(null);
      }
    },
    [read],
  );

  const disable = (row: Row) =>
    after(
      api.setAddonEnabled(row.id, false).then((result) => {
        if (result.cancelled > 0 || result.paused > 0) {
          notify(
            `${row.name} is off. ${count(result.paused, "activity", "activities")} paused, ${count(result.cancelled, "block", "blocks")} taken off today.`,
          );
        }
      }),
      "Couldn't change that just now.",
    );

  const enable = (row: Row) =>
    after(
      api.setAddonEnabled(row.id, true).then((result) => {
        if ((result.resumed ?? 0) > 0) {
          notify(
            `${row.name} is on. ${count(result.resumed ?? 0, "activity", "activities")} switched back on.`,
          );
        }
      }),
      "Couldn't change that just now.",
    );

  const remove = (row: Row) =>
    after(
      api.removeAddon(row.id).then(() => forgetAddon(row.id)),
      "Couldn't remove that just now.",
    );

  /** Allow everything the manifest asks for, including what is new. */
  const allowAll = (row: Row) => {
    setBusy(row.id);
    void after(
      api.installAddon(row.id, row.capabilities),
      "Couldn't change that just now.",
    );
  };

  /** Ask the server what this would cost, and only then ask the user. */
  const confirmThen = (row: Row, kind: Asking["kind"]) => {
    setBusy(row.id);
    api
      .addonImpact(row.id)
      .then((impact) => {
        if (impact.activities.length === 0) {
          return kind === "remove" ? remove(row) : disable(row);
        }
        setAsking({ row, impact, kind });
        setBusy(null);
      })
      .catch(() => {
        notify("Couldn't check what that would affect.");
        setBusy(null);
      });
  };

  const rows = rowsOf(available ?? [], installed);

  return (
    <div className="wr-page-scroll">
      <div className="wr-measure">
        <h2 className="wr-settings-title">Addons</h2>

        <p className="wr-body" style={{ margin: "0 0 22px" }}>
          Every guided session and every card in the rail is an addon, including
          the ones we wrote. Each says what it needs, and can do nothing else.
          Switch one off and it stops running - any activities that use it are
          paused until you switch it back on.
        </p>

        <div style={{ display: "grid", gap: 14 }}>
          {available === null ? (
            <p className="wr-body">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="wr-body">
              Nothing here yet. Addons appear once they have been reviewed.
            </p>
          ) : null}

          {rows.map((row) => {
            const granted = row.installed ? grantOf(row.installed) : null;
            const missing = granted ? ungranted(row.capabilities, granted) : [];
            return (
              <Card
                key={row.id}
                title={row.name}
                note={`${row.author} · ${row.version}`}
              >
                <p className="wr-body" style={{ margin: 0 }}>
                  {row.description}
                </p>

                {row.installed?.revoked ? (
                  <p
                    className="wr-body"
                    style={{ margin: "8px 0 0", fontWeight: 600 }}
                  >
                    Withdrawn from the registry. It has stopped running; remove
                    it when convenient.
                  </p>
                ) : null}

                <Permissions
                  capabilities={granted ?? row.capabilities}
                  {...(granted && missing.length > 0
                    ? { title: "Allowed" }
                    : {})}
                />

                {granted && missing.length > 0 ? (
                  <>
                    <Permissions title="Also asks for" capabilities={missing} />
                    <div style={{ marginTop: 8 }}>
                      <Button
                        variant="secondary"
                        disabled={busy === row.id}
                        onClick={() => allowAll(row)}
                      >
                        Allow
                      </Button>
                    </div>
                  </>
                ) : null}

                {row.installed &&
                row.manifest &&
                row.manifest.settings.length > 0 ? (
                  <AddonSettings
                    id={row.id}
                    manifest={row.manifest}
                    stored={row.installed.settings}
                    onSaved={async () => {
                      await read();
                      await loadAddons();
                    }}
                  />
                ) : null}

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
                          // Switching on costs nothing, so it never asks.
                          if (next) {
                            setBusy(row.id);
                            void enable(row);
                          } else {
                            confirmThen(row, "disable");
                          }
                        }}
                      />
                      {row.installed.bundled ? null : (
                        <Button
                          variant="quiet"
                          disabled={busy === row.id}
                          onClick={() => confirmThen(row, "remove")}
                        >
                          Remove
                        </Button>
                      )}
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
            );
          })}
        </div>
      </div>

      {asking ? (
        <Modal
          title={
            asking.kind === "remove"
              ? `Remove ${asking.row.name}?`
              : `Switch ${asking.row.name} off?`
          }
          subtitle={consequence(asking)}
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button
                variant="primary"
                disabled={busy === asking.row.id}
                onClick={() => {
                  setBusy(asking.row.id);
                  void (asking.kind === "remove"
                    ? remove(asking.row)
                    : disable(asking.row));
                }}
              >
                {asking.kind === "remove" ? "Remove" : "Switch off"}
              </Button>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </>
          }
        >
          <ul
            className="wr-body"
            style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3 }}
          >
            {asking.impact.activities.map((activity) => (
              <li key={activity.id}>{activity.name}</li>
            ))}
          </ul>
          <p className="wr-body" style={{ margin: "12px 0 0" }}>
            {asking.kind === "remove"
              ? "You can install it again later; your settings are kept."
              : "Switch it back on and they return, exactly as they were."}
          </p>
        </Modal>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/addons")({ component: Addons });
