import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  type CalendarProvider,
  Modal,
  ProviderChoice,
  SetupModule,
} from "@wiseroutine/design";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  alertPermissionGranted,
  alertsAvailable,
  ensureAlertPermission,
} from "../lib/alerts";
import { api } from "../lib/api";
import { beginConnect } from "../lib/calendar-connect";
import { accountStorageKey } from "../lib/session-lifecycle";
import { DAY_HOURS_ANCHOR } from "../lib/settings-sections";

/**
 * The rail's set-up module, and the sheet its one button opens.
 *
 * A calendar, one activity and working hours establish the routine.
 * Notification permission is optional and never blocks setup completion.
 *
 * The notification step is not offered in a browser, where there is no menu
 * bar to be reminded from and nothing to grant.
 *
 * Each step retires itself by being satisfied, not by being pressed: the
 * calendar step goes when a connection lands, the activities step when one is
 * active. The module goes when the last one does, and does not come back.
 *
 * That last part is the difference between a checklist and a wizard, and this
 * is a wizard. It reads live state, so left to itself it would reappear the
 * moment any of that state stopped being true - delete both activities six
 * months in and you would be walked through getting started again, as if the
 * app had forgotten who you were. Finishing is therefore recorded, once, and
 * from then on nothing here asks anything.
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

/**
 * That the whole thing has been through once.
 *
 * Separate from the three steps rather than derived from them, because it is a
 * different fact: the steps say what is true now, and this says what happened.
 * Deriving it is exactly the bug - an account whose activities are all deleted
 * has an unsatisfied step and has still, unmistakably, been set up.
 *
 * ponytail: local to this device, like the hours flag above. Signing in on a
 * second machine asks again, and mostly answers itself - the calendar and the
 * activities are already there, so only the hours are left to look at. A column
 * on the user row is the fix if that ever grates.
 */
const DONE = "wr.setup.done";

const remembered = (key: string): boolean => {
  try {
    return globalThis.localStorage?.getItem(accountStorageKey(key)) === "1";
  } catch {
    // Private windows and locked-down profiles throw on access rather than
    // returning null. Not remembering asks again, which is a small annoyance;
    // the alternative is a step nobody can ever complete.
    return false;
  }
};

const remember = (key: string): void => {
  try {
    globalThis.localStorage?.setItem(accountStorageKey(key), "1");
  } catch {
    // Then it asks again next launch. Nothing else breaks.
  }
};

/** How many activities the first plan needs before it can shape a day. */
const ENOUGH_ACTIVITIES = 1;

export const SetupRail: React.FC = () => {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [seenHours, setSeenHours] = useState(() => remembered(HOURS_SEEN));
  const [finished, setFinished] = useState(() => remembered(DONE));
  const [connecting, setConnecting] = useState(false);
  const [connectionProblem, setConnectionProblem] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState<CalendarProvider | null>(null);
  /** Null while unknown, and in a browser it stays null - a step that cannot
   *  exist is never counted rather than being counted as failed. */
  const [alerts, setAlerts] = useState<boolean | null>(null);
  const [readProblem, setReadProblem] = useState(false);
  const revision = useRef(0);

  const look = useCallback(() => {
    // Nothing left to ask about, and no answer that could bring this back.
    if (finished) return;

    const request = ++revision.current;
    setReadProblem(false);
    setConnected(null);
    setActive(null);
    void Promise.allSettled([api.calendars(), api.activities()]).then(
      ([calendars, activities]) => {
        if (request !== revision.current) return;
        setConnected(
          calendars.status === "fulfilled"
            ? calendars.value.connections.length > 0
            : null,
        );
        setActive(
          activities.status === "fulfilled"
            ? activities.value.filter((row) => row.isActive).length
            : null,
        );
        setReadProblem(
          calendars.status === "rejected" || activities.status === "rejected",
        );
      },
    );

    // Granted in a system dialog outside this window, so it is re-read on
    // every look rather than only when the button is pressed.
    if (alertsAvailable()) void alertPermissionGranted().then(setAlerts);
  }, [finished]);

  useEffect(() => {
    look();
    return () => {
      revision.current++;
    };
  }, [look]);

  // Consent completes in a browser, and activities are added on another page,
  // so coming back to this window is the only signal this one gets that
  // anything has happened.
  useEffect(() => {
    globalThis.addEventListener?.("focus", look);
    return () => globalThis.removeEventListener?.("focus", look);
  }, [look]);

  const enough = active !== null && active >= ENOUGH_ACTIVITIES;
  // Permission is optional; denial must never block a usable routine.
  const complete = connected === true && enough && seenHours;

  // Written the moment it is first true, and never read as a live question
  // again - see `DONE`.
  useEffect(() => {
    if (!complete) return;
    setFinished(true);
    remember(DONE);
  }, [complete]);

  if (finished) return null;
  if (readProblem)
    return (
      <section aria-label="Setup">
        <p role="alert">
          Couldn't check your setup. Your progress hasn't been changed.
        </p>
        <Button onClick={look}>Retry setup check</Button>
      </section>
    );
  // Nothing until both reads land: a checklist that ticks its steps one at a
  // time as the answers arrive reads as progress the user did not make.
  if (connected === null || active === null) return null;
  // The same frame the effect above runs in, so finishing the last step does
  // not flash a completed checklist before it goes.
  if (complete) return null;

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
            label: "Add your first activity",
            detail:
              "Choose one thing you want to make time for. Its routine starts tomorrow.",
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
                remember(HOURS_SEEN);
                void navigate({ to: "/settings", hash: DAY_HOURS_ANCHOR });
              },
            },
          },
          ...(alertsAvailable()
            ? [
                {
                  key: "alerts",
                  label: "Allow notifications (optional)",
                  detail:
                    "So a slot can tell you it is starting, even when the window is behind something else.",
                  done: alerts === true,
                  action: {
                    label: "Allow",
                    onClick: () => {
                      void ensureAlertPermission().then(setAlerts);
                    },
                  },
                },
              ]
            : []),
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
              setConnectionProblem(null);
              void beginConnect(provider).then((failure) => {
                setBusy(null);
                if (failure) setConnectionProblem(failure);
                else setConnecting(false);
              });
            }}
          />
          {connectionProblem ? (
            <p className="wr-auth-problem" role="alert">
              {connectionProblem}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
};
