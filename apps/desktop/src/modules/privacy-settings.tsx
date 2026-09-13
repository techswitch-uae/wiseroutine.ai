import { Card, Toggle } from "@wiseroutine/design";
import { useId, useState } from "react";
import { api } from "../lib/api";
import { sessionGeneration } from "../lib/session-lifecycle";

export function PrivacySettings({
  storeDetails,
  onSaved,
}: {
  storeDetails: boolean;
  onSaved: (enabled: boolean) => void;
}) {
  const descriptionId = useId();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (enabled: boolean) => {
    const generation = sessionGeneration();
    setSaving(true);
    setProblem(null);
    try {
      await api.updateSettings({ storeEventTitles: enabled });
      if (generation === sessionGeneration()) onSaved(enabled);
    } catch {
      if (generation === sessionGeneration())
        setProblem("Couldn't confirm the change. Please try again.");
    } finally {
      if (generation === sessionGeneration()) setSaving(false);
    }
  };
  return (
    <div className="wr-account" aria-busy={saving}>
      <Card
        title="Save meeting details"
        action={
          <Toggle
            label="Save meeting details"
            describedBy={descriptionId}
            checked={storeDetails}
            disabled={saving}
            onChange={(enabled) => void save(enabled)}
          />
        }
        note={
          storeDetails
            ? "Wise Routine saves meeting names, notes, and call links."
            : "Only busy times are saved. Meeting names, notes, and call links are not saved."
        }
      >
        <p id={descriptionId} className="wr-body" style={{ margin: 0 }}>
          {storeDetails
            ? "Turning this off removes saved meeting details and stops saving new ones. Busy times stay, so your activities still fit around meetings. Your original calendar will not change."
            : "Your activities still fit around meetings. Turn this on to save meeting details from future calendar syncs. Your original calendar will not change."}
        </p>
        {problem ? (
          <p className="wr-auth-problem" role="alert">
            {problem}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
