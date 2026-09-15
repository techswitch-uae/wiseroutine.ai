import { Button } from "@wiseroutine/design";
import { useEffect, useId, useRef, useState } from "react";
import {
  alertPermissionGranted,
  alertsAvailable,
  ensureAlertPermission,
} from "../lib/alerts";

/** Recovery stays available after onboarding, without prompting on render. */
export function NotificationSettings() {
  const heading = useId();
  const available = alertsAvailable();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    if (!available) return;
    const check = () => {
      const request = ++revision.current;
      void alertPermissionGranted().then((value) => {
        if (request === revision.current) setGranted(value);
      });
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      revision.current++;
      window.removeEventListener("focus", check);
    };
  }, [available]);
  if (!available) return null;
  return (
    <section aria-labelledby={heading} className="wr-settings-section">
      <h2 id={heading} className="wr-settings-title">
        Notifications
      </h2>
      <p role="status">
        {granted === null
          ? "Checking notification permission…"
          : granted
            ? "Notifications are allowed."
            : "Notifications aren't allowed. If you previously declined, enable Wise Routine in your system notification settings, then check again."}
      </p>
      <div className="wr-row">
        {granted === false ? (
          <Button
            disabled={asking}
            onClick={() => {
              setAsking(true);
              const request = ++revision.current;
              void ensureAlertPermission()
                .then((value) => {
                  if (request === revision.current) setGranted(value);
                })
                .finally(() => setAsking(false));
            }}
          >
            Allow notifications
          </Button>
        ) : null}
        <Button
          disabled={asking}
          onClick={() => {
            const request = ++revision.current;
            void alertPermissionGranted().then((value) => {
              if (request === revision.current) setGranted(value);
            });
          }}
        >
          Check again
        </Button>
      </div>
    </section>
  );
}
