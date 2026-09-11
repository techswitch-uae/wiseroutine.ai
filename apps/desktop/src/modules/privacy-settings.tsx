import { Card, Toggle } from "@wiseroutine/design";
import { useState } from "react";
import { api } from "../lib/api";
import { sessionGeneration } from "../lib/session-lifecycle";

export function PrivacySettings({
  storeDetails,
  onSaved,
}: {
  storeDetails: boolean;
  onSaved: (enabled: boolean) => void;
}) {
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
        setProblem("Couldn't confirm the privacy change. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
        <legend>Meeting details</legend>
        <p>Store meeting titles, notes, and call links</p>
        <Toggle
          label="Store meeting details"
          checked={storeDetails}
          onChange={(enabled) => {
            void save(enabled);
          }}
        />
        <p>
          Turning this off erases stored details. Meeting times still block your
          schedule. Turning it back on allows details from future calendar
          syncs.
        </p>
        {problem ? <p role="alert">{problem}</p> : null}
      </fieldset>
    </Card>
  );
}
