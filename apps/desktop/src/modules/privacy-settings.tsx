import { Block, Button, Slot } from "@wiseroutine/design";
import { useId, useState } from "react";
import { api } from "../lib/api";
import { sessionGeneration } from "../lib/session-lifecycle";

/**
 * Whether meeting details are kept.
 *
 * A choice with a preview rather than a toggle: turning this off deletes
 * what is saved, so the user should see what Today will show - a named
 * meeting or "Busy" - before they commit. Update and Cancel appear in the
 * block foot only while the ticked row differs from what is saved, the same
 * shape Name and Working hours use.
 */
export function PrivacySettings({
  storeDetails,
  onSaved,
}: {
  storeDetails: boolean;
  onSaved: (enabled: boolean) => void;
}) {
  const groupId = useId();
  const [draft, setDraft] = useState(storeDetails);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = draft !== storeDetails;

  const save = async () => {
    const generation = sessionGeneration();
    setSaving(true);
    setProblem(null);
    try {
      await api.updateSettings({ storeEventTitles: draft });
      if (generation === sessionGeneration()) onSaved(draft);
    } catch {
      if (generation === sessionGeneration())
        setProblem("Couldn't confirm the change. Please try again.");
    } finally {
      if (generation === sessionGeneration()) setSaving(false);
    }
  };

  const option = (value: boolean, name: string, note: string) => (
    <li className="wr-calpick-row">
      <label className="wr-calpick-label">
        <input
          type="radio"
          name={groupId}
          className="wr-calpick-box"
          checked={draft === value}
          disabled={saving}
          onChange={() => setDraft(value)}
        />
        <span className="wr-calpick-body">
          <span className="wr-calpick-name">{name}</span>
          <span className="wr-calpick-note">{note}</span>
        </span>
      </label>
    </li>
  );

  return (
    <div className="wr-account" aria-busy={saving}>
      <div className="wr-blocks">
        <Block
          title="Meeting details"
          note="What Wise Routine keeps from your calendar. Your original calendar never changes."
          {...(changed
            ? {
                footer: (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => void save()}
                      disabled={saving}
                    >
                      {saving ? "Updating…" : "Update"}
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => setDraft(storeDetails)}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </>
                ),
              }
            : {})}
        >
          <ul className="wr-calpick" aria-label="Meeting details">
            {option(
              true,
              "Save meeting details",
              "Names, notes and call links are saved, so Today can show what each meeting is.",
            )}
            {option(
              false,
              "Busy times only",
              "Only when you are busy is saved. Meetings show as “Busy”.",
            )}
          </ul>
          <div style={{ margin: "12px 0 0 10px" }}>
            <div className="wr-label">How a meeting shows in Today</div>
            <div style={{ marginTop: 7 }}>
              <Slot
                variant="meeting"
                time="10:00"
                name={draft ? "Weekly planning" : "Busy"}
                meta="45 min"
                source="G"
              />
            </div>
            {changed ? (
              <p
                className="wr-block-note"
                style={{ margin: "9px 0 0 var(--wr-gutter)" }}
              >
                {draft
                  ? "Details are saved from the next calendar sync onwards. Meetings already on the day stay as “Busy” until then."
                  : "Saved names, notes and call links are removed when you update. Busy times stay, so your activities still fit around meetings."}
              </p>
            ) : null}
          </div>
          {problem ? (
            <p className="wr-auth-problem" role="alert">
              {problem}
            </p>
          ) : null}
        </Block>
      </div>
    </div>
  );
}
