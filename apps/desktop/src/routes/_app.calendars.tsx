import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  CalendarPicker,
  type CalendarProvider,
  Card,
  Loading,
  ProviderChoice,
} from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { api, type CalendarConnection, type CalendarSummary } from "../lib/api";
import {
  applyTick,
  changedIn,
  type Draft,
  type DraftCalendar,
  draftFrom,
  revertIn,
} from "../lib/calendar-draft";
import { openExternal } from "../lib/open-external";

/**
 * Which calendars we read, and from whose account.
 *
 * Reading only. The design offered a "write my slots to" step alongside this
 * one; it is deliberately absent, because the app does not write to anyone's
 * calendar and offering the choice would describe a capability that is not
 * there.
 */
const PROVIDER_NAME: Record<string, string> = {
  google: "Google",
  microsoft: "Outlook",
};

/**
 * Start a provider's consent flow in the real browser.
 *
 * Shared with the modal on Today, which is why it lives here as its own
 * function rather than inside a component: both entry points have to behave
 * identically, including the part where opening can fail.
 */
export async function beginConnect(
  provider: CalendarProvider,
): Promise<string | null> {
  try {
    const url = await api.connectUrl(provider);
    if (!(await openExternal(url))) {
      return "Couldn't open your browser. Allow pop-ups and try again.";
    }
    return null;
  } catch {
    return "Couldn't start that connection. Try again.";
  }
}

const Calendars: React.FC = () => {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  /**
   * The ticks as the user has left them, before Update.
   *
   * Kept apart from `calendars` - which stays as the server last described it
   * - so "has anything changed?" is a comparison rather than a flag somebody
   * has to remember to set, and Cancel is just throwing this away.
   */
  const [draft, setDraft] = useState<Draft>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<CalendarProvider | null>(null);
  /** The connection being saved, so one account's spinner cannot appear on
   *  another's buttons. */
  const [saving, setSaving] = useState<string | null>(null);
  /** The connection whose unsaved ticks are currently on screen, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .calendars()
      .then((response) => {
        setConnections(response.connections);
        setCalendars(response.calendars);
        setDraft(draftFrom(response.calendars));
        setEditing(null);
        setProblem(null);
      })
      .catch(() => setProblem("Couldn't load your calendars."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load]);

  /**
   * Consent finishes in a browser, not here, so this window has no idea when
   * it is done. Re-reading on focus is what turns "I just approved it" into a
   * connection appearing, without a refresh button nobody should need.
   *
   * Held back while there are unsaved ticks: reloading would silently discard
   * them, and losing someone's edit to a background refresh is worse than
   * showing a connection a moment late.
   */
  const dirty = calendars.filter((cal) => draft[cal.id] !== cal.isSelected);
  useEffect(() => {
    if (dirty.length > 0) return;
    globalThis.addEventListener?.("focus", load);
    return () => globalThis.removeEventListener?.("focus", load);
  }, [load, dirty.length]);

  /**
   * Tick a calendar, and put any other account's ticks back.
   *
   * Only one account may have unsaved changes at a time. Two sets of pending
   * ticks with an Update button each looks like two independent edits, but
   * saving one used to reload the page and silently discard the other - so
   * rather than leaving that trap open, starting on a second account closes
   * the first one down.
   */
  const toggle = (connectionId: string, id: string, isSelected: boolean) => {
    setDraft((all) =>
      applyTick(all, calendars, editing, connectionId, id, isSelected),
    );
    setEditing(connectionId);
  };

  const connect = (provider: CalendarProvider) => {
    setBusy(provider);
    setProblem(null);
    void beginConnect(provider).then((failure) => {
      setBusy(null);
      if (failure) setProblem(failure);
    });
  };

  /**
   * Apply the ticks, then make the day catch up.
   *
   * The sync is the point. Selecting a calendar has nothing to show until its
   * events are fetched, and deselecting one used to leave its meetings on the
   * day indefinitely - so "Update" means both halves, and the reload after it
   * is what proves to the user that it took.
   */
  const update = (connectionId: string, changed: readonly DraftCalendar[]) => {
    setSaving(connectionId);
    setProblem(null);
    Promise.all(
      changed.map((cal) => api.selectCalendar(cal.id, draft[cal.id] === true)),
    )
      .then(() => api.sync())
      .then(load)
      .catch(() => setProblem("Couldn't save that. Your ticks are still here."))
      .finally(() => setSaving(null));
  };

  const disconnect = (connectionId: string) => {
    setSaving(connectionId);
    setProblem(null);
    api
      .disconnect(connectionId)
      .then(load)
      .catch(() => setProblem("Couldn't disconnect that account. Try again."))
      .finally(() => {
        setSaving(null);
        setConfirming(null);
      });
  };

  if (!loaded) return <Loading>Loading your calendars…</Loading>;

  return (
    // The scroller is full width so its scrollbar sits at the page edge; the
    // reading measure is a column inside it.
    <div className="wr-page-scroll">
      <div className="wr-measure">
        {/* Named the same way Activities and Settings are. The title sits
            outside the grid below so its own bottom margin is the gap under
            it, rather than being added to the grid's. */}
        <h2 className="wr-settings-title">Calendars</h2>

        <div style={{ display: "grid", gap: 26 }}>
          {problem ? (
            <p className="wr-auth-problem" role="alert">
              {problem}
            </p>
          ) : null}

          {connections.map((connection) => {
            const under = calendars.filter(
              (cal) => cal.connectionId === connection.id,
            );
            const on = under.filter((cal) => draft[cal.id]).length;
            const changed = changedIn(draft, calendars, connection.id);

            return (
              <Card
                key={connection.id}
                title={`${PROVIDER_NAME[connection.provider] ?? connection.provider} · ${connection.email}`}
                note={
                  connection.status === "active"
                    ? `Reading ${on} of ${under.length} calendars`
                    : "Needs reconnecting - we can't read this account right now"
                }
                {...(confirming === connection.id
                  ? {}
                  : {
                      action: (
                        <Button
                          variant="quiet"
                          onClick={() => setConfirming(connection.id)}
                          disabled={saving !== null}
                        >
                          Disconnect
                        </Button>
                      ),
                    })}
              >
                {confirming === connection.id ? (
                  // Asked before doing, because this one cannot be undone from
                  // inside the app: getting the account back means going through
                  // the provider's consent screen again.
                  <div className="wr-confirm" role="alert">
                    <p className="wr-confirm-text">
                      Disconnect <b>{connection.email}</b>? Its calendars and
                      the meetings we read from them are deleted. Slots already
                      placed stay where they are, and reconnecting means signing
                      in again.
                    </p>
                    <div className="wr-confirm-actions">
                      <Button
                        variant="primary"
                        onClick={() => disconnect(connection.id)}
                        disabled={saving !== null}
                      >
                        {saving === connection.id
                          ? "Disconnecting…"
                          : "Disconnect"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirming(null)}
                        disabled={saving !== null}
                      >
                        Keep it
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <CalendarPicker
                      calendars={under.map((cal) => ({
                        id: cal.id,
                        name: cal.name,
                        isSelected: draft[cal.id] === true,
                        isPrimary: cal.isPrimary,
                      }))}
                      onToggle={(id, isSelected) =>
                        toggle(connection.id, id, isSelected)
                      }
                    />
                    {changed.length > 0 ? (
                      <div
                        className="wr-confirm-actions"
                        style={{ marginTop: 10 }}
                      >
                        <Button
                          variant="primary"
                          // Only this account's ticks. A single Update that
                          // silently applied another account's pending changes
                          // too would be a surprise, and the button sits under
                          // one of them.
                          onClick={() => update(connection.id, changed)}
                          disabled={saving !== null}
                        >
                          {saving === connection.id ? "Updating…" : "Update"}
                        </Button>
                        <Button
                          variant="quiet"
                          onClick={() => {
                            setDraft((all) =>
                              revertIn(all, calendars, connection.id),
                            );
                            setEditing(null);
                          }}
                          disabled={saving !== null}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </Card>
            );
          })}

          <Card
            title={
              connections.length > 0 ? "Connect another" : "Connect a calendar"
            }
            note="You can add more later, and disconnect any of them without losing your slots."
          >
            <ProviderChoice onChoose={connect} busy={busy} />
          </Card>
        </div>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_app/calendars")({
  component: Calendars,
});
