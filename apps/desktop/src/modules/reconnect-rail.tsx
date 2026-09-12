import { Button, Widget } from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { api, type CalendarConnection } from "../lib/api";
import { beginConnect } from "../routes/_app.calendars";

const PROVIDER_NAME: Record<string, string> = {
  google: "Google",
  microsoft: "Outlook",
};

/**
 * "This account needs reconnecting", at the top of the rail.
 *
 * A revoked or aged-out grant is silent: the day simply stops filling in, and
 * the only other place that says so is the connection's own card on Calendars
 * - the page nobody opens precisely because they have no reason to think
 * anything is wrong. So it comes to them instead, in the one column that is
 * already where they look when the day is not what they expected.
 *
 * First in the rail, ahead even of the block they just pressed. Everything
 * else there describes a day; this says the day is wrong, and a correction
 * underneath what it corrects is a correction nobody reads.
 *
 * The button starts consent for that connection's own provider rather than
 * sending the user to Calendars to find the same button - signing in again is
 * the whole repair, and the connection upserts back to active on the callback.
 *
 * ponytail: reuses `api.calendars()` rather than adding a status endpoint. If
 * that payload ever grows past a page of connections, give it its own route.
 */
export const ReconnectRail: React.FC = () => {
  const [broken, setBroken] = useState<CalendarConnection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const look = useCallback(() => {
    void api
      .calendars()
      .then(({ connections }) =>
        setBroken(connections.filter((one) => one.status !== "active")),
      )
      // Offline is not a revoked grant. Leaving the last answer standing beats
      // telling someone on a train to reconnect their calendar - the consent
      // screen would not load for them either.
      .catch(() => undefined);
  }, []);

  useEffect(look, [look]);

  // Consent finishes in a browser, so coming back to this window is the only
  // signal this card gets that the account has been repaired.
  useEffect(() => {
    globalThis.addEventListener?.("focus", look);
    return () => globalThis.removeEventListener?.("focus", look);
  }, [look]);

  if (broken.length === 0) return null;

  return (
    <Widget variant="attention" eyebrow="Reconnect" count={broken.length}>
      {problem ? (
        <p className="wr-auth-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {broken.map((connection) => (
        // Stacked rather than a `StateRow`: the rail is 250px and a row puts
        // an address, a reason and a button on one line, which in that width
        // means all three are unreadable.
        <div key={connection.id} style={{ marginTop: 10 }}>
          <div className="wr-widget-title" style={{ marginTop: 0 }}>
            {connection.email}
          </div>
          <div className="wr-slot-meta" style={{ marginBottom: 8 }}>
            {PROVIDER_NAME[connection.provider] ?? connection.provider} · we
            can't read this account
          </div>
          <Button
            block
            variant="primary"
            disabled={busy !== null}
            onClick={() => {
              setBusy(connection.id);
              setProblem(null);
              void beginConnect(connection.provider).then((failed) => {
                setBusy(null);
                setProblem(failed);
              });
            }}
          >
            {busy === connection.id ? "Opening…" : "Reconnect"}
          </Button>
        </div>
      ))}
    </Widget>
  );
};
