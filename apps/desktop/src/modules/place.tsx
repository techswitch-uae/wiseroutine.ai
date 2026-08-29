import { Button, Chip, clockOf, Modal, TimeStepper } from "@wiseroutine/design";
import { useState } from "react";
import type { OpenGap } from "../lib/api";
import type { Owed } from "../lib/owed";

/**
 * Placing an activity by hand - the free plan's whole shape.
 *
 * Two steps, not four. The design's flow is pick-activity, nudge-the-time,
 * confirm, placed; the gap has already been chosen by clicking the row it is
 * drawn on, so the first of those four is answered before this sheet opens and
 * the last is a toast rather than a screen.
 *
 * ponytail: no fit strip yet. It reads "darker means this fits your usual
 * window for this activity", which needs each activity's preferred windows on
 * the Today response - a field `/today` does not send. Worth adding when the
 * windows are something people actually set; a strip of identical bars says
 * nothing and costs a round trip.
 */

/** Five minutes, the same step the day grid snaps to. */
const STEP_MS = 5 * 60_000;

const clockAt = (ms: number): string => {
  const d = new Date(ms);
  return clockOf(d.getHours() * 60 + d.getMinutes());
};

export const PlaceSheet: React.FC<{
  gap: OpenGap;
  owed: readonly Owed[];
  onClose: () => void;
  onPlace: (activityId: string, startsAt: number, endsAt: number) => void;
}> = ({ gap, owed, onClose, onPlace }) => {
  const [chosen, setChosen] = useState<string | null>(
    owed.length === 1 ? (owed[0]?.id ?? null) : null,
  );
  const [offset, setOffset] = useState(0);

  const activity = owed.find((o) => o.id === chosen);
  const startsAt = gap.startsAt + offset;
  const endsAt = startsAt + (activity?.minutes ?? 0) * 60_000;
  // The nudge stops where the slot would stop fitting, rather than letting it
  // run past the end of the gap and be refused on the way to the server.
  const canLater = activity ? endsAt + STEP_MS <= gap.endsAt : false;
  const canEarlier = offset >= STEP_MS;

  return (
    <Modal
      title={`${gap.minutes} minutes free at ${clockAt(gap.startsAt)}`}
      subtitle="It stays where you put it. If a meeting lands on top, you will be asked to move it."
      onClose={onClose}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {owed.map((row) => (
          <Chip
            key={row.id}
            variant={row.id === chosen ? "selected" : "inset"}
            onClick={() => {
              setChosen(row.id);
              setOffset(0);
            }}
          >
            {row.name} · {row.minutes} min
          </Chip>
        ))}
      </div>

      {owed.length === 0 ? (
        <p className="wr-body" style={{ marginTop: 12 }}>
          Everything with a daily minimum is already done or placed.
        </p>
      ) : null}

      {activity ? (
        <div style={{ marginTop: 16 }}>
          <TimeStepper
            value={clockAt(startsAt)}
            note={`5 min steps · ends ${clockAt(endsAt)}`}
            onStep={(direction) => {
              if (direction === 1 && !canLater) return;
              if (direction === -1 && !canEarlier) return;
              setOffset((o) => o + direction * STEP_MS);
            }}
          />
          <div style={{ marginTop: 16 }}>
            <Button
              variant="commit"
              onClick={() => onPlace(activity.id, startsAt, endsAt)}
            >
              Place at {clockAt(startsAt)}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
};
