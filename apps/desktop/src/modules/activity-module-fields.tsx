import { Chip, SelectField } from "@wiseroutine/design";
import { configFor, MODULES, moduleFor, type StartPolicy } from "./activities";

/**
 * The module half of the activity sheet: what runs, how it starts, and
 * whatever that module asks for.
 *
 * In the app rather than in the design package because the registry is: a
 * component library that had to know breathing has patterns would gain a new
 * import every time a module did.
 *
 * Choosing a module rewrites the two fields it has an opinion about - the
 * session length and the start policy - because those are part of what the
 * module *is*. An eye rest that waits for a button press is not an eye rest,
 * and making someone find that setting themselves is making them configure
 * their way to the obvious.
 */

export interface ModuleDraft {
  presetKey: string | null;
  startPolicy: StartPolicy;
  /** The module's own settings, as the JSON text that is stored. */
  configJson: string | null;
}

const POLICY_LABELS: Record<StartPolicy, string> = {
  manual: "I press start",
  auto: "Starts on its own",
  prompt: "Asks me first",
};

const POLICY_NOTES: Record<StartPolicy, string> = {
  manual: "Moves to the next gap if you have not started it in time.",
  auto: "Runs and completes itself. Best for anything short.",
  prompt: "Sends a notification, and moves on if you do not answer.",
};

const labelToPolicy = (label: string): StartPolicy =>
  (Object.entries(POLICY_LABELS).find(([, l]) => l === label)?.[0] ??
    "manual") as StartPolicy;

export const ActivityModuleFields: React.FC<{
  value: ModuleDraft;
  onChange: (next: ModuleDraft) => void;
  /** Told back to the sheet, which owns the session length. */
  onSessionMinutes: (minutes: number) => void;
}> = ({ value, onChange, onSessionMinutes }) => {
  const module = moduleFor(value.presetKey);
  const names = [
    "Nothing - just a timed slot",
    ...Object.values(MODULES).map((m) => m.name),
  ];
  const current = module?.name ?? names[0];

  return (
    <div className="wr-activity-field">
      <SelectField
        label="What happens when it runs"
        options={names}
        value={current}
        onChange={(event) => {
          const picked = Object.values(MODULES).find(
            (m) => m.name === event.target.value,
          );
          if (!picked) {
            onChange({
              presetKey: null,
              startPolicy: "manual",
              configJson: null,
            });
            return;
          }
          onSessionMinutes(picked.defaults.sessionMinutes);
          onChange({
            presetKey: picked.key,
            startPolicy: picked.defaults.startPolicy,
            configJson: JSON.stringify(picked.defaults.config),
          });
        }}
      />
      {module ? (
        <p className="wr-activity-hint">{module.blurb}</p>
      ) : (
        <p className="wr-activity-hint">
          Appears on the timeline with a start button, and nothing takes over
          the screen.
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        <SelectField
          label="How it starts"
          options={Object.values(POLICY_LABELS)}
          value={POLICY_LABELS[value.startPolicy]}
          onChange={(event) =>
            onChange({
              ...value,
              startPolicy: labelToPolicy(event.target.value),
            })
          }
        />
        <p className="wr-activity-hint">{POLICY_NOTES[value.startPolicy]}</p>
      </div>

      {module?.Config ? (
        <div style={{ marginTop: 14 }}>
          <module.Config
            value={configFor(module, value.configJson)}
            onChange={(next: unknown) =>
              onChange({ ...value, configJson: JSON.stringify(next) })
            }
          />
        </div>
      ) : null}

      {value.startPolicy === "prompt" ? (
        <div style={{ marginTop: 10 }}>
          <Chip variant="static">Needs notifications turned on</Chip>
        </div>
      ) : null}
    </div>
  );
};
