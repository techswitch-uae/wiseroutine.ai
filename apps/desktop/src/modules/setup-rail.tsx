import { useNavigate } from "@tanstack/react-router";
import {
  type CalendarProvider,
  Modal,
  ProviderChoice,
  SetupModule,
} from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { beginConnect } from "../routes/_app.calendars";
import { DAY_HOURS_ANCHOR } from "../routes/_app.settings";

/**
 * The rail's set-up module, and the sheet its one button opens.
 *
 * Three steps, all of them real: a calendar to read, two activities to place
 * in it, and a look at the hours everything is placed between. There is no way
 * out but finishing, because there is nothing the app can do until all three
 * are true - a day with no calendar and no activities is an empty ruler, and
 * "Skip for now" only ever bought a blank screen with no explanation on it.
 *
 * Each step retires itself by being satisfied, not by being pressed: the
 * calendar step goes when a connection lands, the activities step when two are
 * active. The module goes when the last one does.
 */

/**
 * That the user has looked at their working hours.
 *
 * The only one of the three with nothing in the database to check, because
 * confirming an already-correct default changes nothing - there is no "yes,
 * 09:00 to 18:00 is right" to store. So it is remembered here, on the machine
 * where the looking happened.
 *
 * ponytail: local to this device. A column on the user row if it ever needs to
 * follow someone to a second machine.
 */
const HOURS_SEEN = "wr.setup.hours";

const hoursSeen = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(HOURS_SEEN) === "1";
  } catch {
    // Private windows and locked-down profiles throw on access rather than
    // returning null. Not remembering asks again, which is a small annoyance;
    // the alternative is a step nobody can ever complete.
    return false;
  }
};

/** How many activities the first plan needs before it can shape a day. */
const ENOUGH_ACTIVITIES = 2;

export const SetupRail: React.FC = () => {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [seenHours, setSeenHours] = useState(hoursSeen);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<CalendarProvider | null>(null);

  const look = useCallback(() => {
    api
      .calendars()
      .then((response) => setConnected(response.connections.length > 0))
      // A failed read is not proof of no calendar, and asking someone who is
      // already set up to set up again is worse than showing nothing.
      .catch(() => setConnected(true));

    api
      .activities()
      .then((rows) => setActive(rows.filter((row) => row.isActive).length))
      .catch(() => setActive(ENOUGH_ACTIVITIES));
  }, []);

  useEffect(look, [look]);

  // Consent completes in a browser, and activities are added on another page,
  // so coming back to this window is the only signal this one gets that
  // anything has happened.
  useEffect(() => {
    globalThis.addEventListener?.("focus", look);
    return () => globalThis.removeEventListener?.("focus", look);
  }, [look]);

  // Nothing until both reads land: a checklist that ticks its steps one at a
  // time as the answers arrive reads as progress the user did not make.
  if (connected === null || active === null) return null;

  const enough = active >= ENOUGH_ACTIVITIES;
  if (connected && enough && seenHours) return null;

  return (
    <>
      <SetupModule
        tone="dark"
        steps={[
          {
            key: "calendar",
            label: "Connect a calendar",
            detail:
              "Google or Outlook. We only read your times - nothing is ever written back.",
            done: connected,
            action: { label: "Connect", onClick: () => setConnecting(true) },
          },
          {
            key: "activities",
            label: "Add two activities",
            detail:
              "A stretch and something for your eyes is a good pair to start with.",
            done: enough,
            action: {
              label: "Add an activity",
              onClick: () => void navigate({ to: "/activities" }),
            },
          },
          {
            key: "hours",
            label: "Confirm working hours",
            detail:
              "Everything is placed inside these. Change them if the default is not your day.",
            done: seenHours,
            action: {
              label: "Check my hours",
              onClick: () => {
                // Marked on the way there rather than on the way back: this
                // window is not told when someone scrolls a settings page, and
                // a step that can only be finished by an event we never
                // receive is a step nobody can finish.
                setSeenHours(true);
                try {
                  globalThis.localStorage?.setItem(HOURS_SEEN, "1");
                } catch {
                  // Then it asks again next launch. Nothing else breaks.
                }
                void navigate({ to: "/settings", hash: DAY_HOURS_ANCHOR });
              },
            },
          },
        ]}
      />

      {connecting ? (
        <Modal
          title="Connect a calendar"
          subtitle="You can add more later, and disconnect any of them without losing your slots."
          onClose={() => setConnecting(false)}
        >
          <ProviderChoice
            busy={busy}
            onChoose={(provider) => {
              setBusy(provider);
              void beginConnect(provider).then(() => {
                setBusy(null);
                // Consent carries on in the browser; the sheet has done its
                // job and the step ticks itself when the account lands.
                setConnecting(false);
              });
            }}
          />
        </Modal>
      ) : null}
    </>
  );
};
