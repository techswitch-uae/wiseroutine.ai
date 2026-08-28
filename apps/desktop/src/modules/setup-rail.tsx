import {
  type CalendarProvider,
  Modal,
  ProviderChoice,
  SetupModule,
} from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { beginConnect } from "../routes/_app.calendars";

/** Dismissing is forever, and has to outlive the window to mean anything. */
const DISMISSED = "wr.setup.dismissed";

const wasDismissed = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(DISMISSED) === "1";
  } catch {
    // Private windows and locked-down profiles throw on access rather than
    // returning null. Not remembering is the right failure: the module comes
    // back, which is annoying, rather than never appearing at all.
    return false;
  }
};

/**
 * The rail's set-up module, and the sheet its one button opens.
 *
 * Shown only while no calendar is being read — the module exists to fix
 * exactly that, so a connected account is the thing that retires it. Dismissal
 * is the other way out and is permanent, which is why it is remembered outside
 * React.
 *
 * The design's checklist had three steps. Two of them — adding activities and
 * confirming working hours — are not built, and a checklist that lists work
 * the app cannot do is a promise it cannot keep, so only the real step is
 * here. The kit still carries all three for when they exist.
 */
export const SetupRail: React.FC = () => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<CalendarProvider | null>(null);

  const look = useCallback(() => {
    api
      .calendars()
      .then((response) => setConnected(response.connections.length > 0))
      // A failed read is not proof of no calendar, and flashing the module at
      // someone who is already set up is worse than showing nothing.
      .catch(() => setConnected(true));
  }, []);

  useEffect(look, [look]);

  // Consent completes in a browser, so coming back to the window is the only
  // signal this one gets that anything happened.
  useEffect(() => {
    globalThis.addEventListener?.("focus", look);
    return () => globalThis.removeEventListener?.("focus", look);
  }, [look]);

  if (dismissed || connected !== false) return null;

  return (
    <>
      <SetupModule
        steps={[
          {
            key: "calendar",
            label: "Connect a calendar",
            detail:
              "Google or Outlook. We only read your times — nothing is ever written back.",
            action: { label: "Connect", onClick: () => setConnecting(true) },
          },
        ]}
        onDismiss={() => {
          setDismissed(true);
          try {
            globalThis.localStorage?.setItem(DISMISSED, "1");
          } catch {
            // Then it comes back next launch. Nothing else breaks.
          }
        }}
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
                // job and the module retires itself when the account lands.
                setConnecting(false);
              });
            }}
          />
        </Modal>
      ) : null}
    </>
  );
};
