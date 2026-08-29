import { Button, Chip, StateRow, Widget } from "@wiseroutine/design";
import { useState } from "react";
import { useAccount } from "../lib/account";
import { api } from "../lib/api";
import { notify } from "../lib/notify";
import { owedToday } from "../lib/owed";
import { reloadPlan, usePlan } from "../lib/plan-store";

/**
 * What today still owes, and one press to put it on the day.
 *
 * The free plan's placement, and deliberately not a row hidden between two
 * meetings. Offering "31 min free at 23:29 - place here" beside every gap made
 * the timeline argue with itself: most gaps are not somewhere anyone wants a
 * stretch, and the ones at the edges of the day were actively silly. Filling
 * the day is one decision about the whole day, so it is one button, in the
 * rail, next to what it is going to place.
 *
 * Nothing here is materialised in advance. Pressing this runs the scheduler
 * for the rest of today only - which is also the answer to what a month or a
 * year view would place, namely nothing.
 *
 * On Pro the day is already filled by the time this could render, so it
 * quietly never appears.
 */
export const ToPlace: React.FC = () => {
  const plan = usePlan();
  const account = useAccount();
  const [placing, setPlacing] = useState(false);

  const owed = owedToday(plan?.progress ?? []);
  if (!plan || owed.length === 0) return null;

  const total = owed.reduce((sum, row) => sum + row.left, 0);

  const place = () => {
    setPlacing(true);
    api
      .plan()
      .then(({ placed, unplaced }) => {
        // Said out loud when the day could not take everything. Silence here
        // reads as "done", and the tray still standing there afterwards with
        // two items left in it reads as the button not working.
        if (unplaced.length > 0) {
          notify(
            placed > 0
              ? `Placed ${placed}. No room today for ${unplaced.length} more.`
              : "No gaps big enough today.",
          );
        }
      })
      .catch(() => notify("Couldn't fill the day just now."))
      .finally(() => {
        setPlacing(false);
        reloadPlan();
      });
  };

  return (
    <Widget eyebrow="To place today" count={total}>
      {owed.map((row) => (
        <div key={row.id} style={{ marginTop: 8 }}>
          <StateRow
            recessed
            name={row.name}
            leading={<Chip variant="static">{row.left}</Chip>}
            trailing={
              <span
                style={{
                  font: "400 11.5px var(--font-body)",
                  color: "var(--wr-text-muted)",
                }}
              >
                {row.minutes} min
              </span>
            }
          />
        </div>
      ))}

      <div style={{ marginTop: 12 }}>
        <Button variant="commit" onClick={place} disabled={placing}>
          {placing ? "Finding gaps…" : "Place them"}
        </Button>
      </div>

      {account?.plan === "free" ? (
        <p className="wr-body" style={{ marginTop: 10, marginBottom: 0 }}>
          Pro does this each morning, and again whenever a meeting moves.
        </p>
      ) : null}
    </Widget>
  );
};
