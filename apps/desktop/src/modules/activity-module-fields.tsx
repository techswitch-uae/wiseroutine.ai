import { Segmented, SwitchRow } from "@wiseroutine/design";
import { notify } from "../lib/notify";
import { openExternal } from "../lib/open-external";
import { configFor, moduleFor, type StartPolicy } from "./activities";

/**
 * The behaviour half of the activity sheet.
 *
 * Two questions, and only for an activity that has a behaviour at all:
 * whether its guided session runs, and how the slot starts. Which module runs
 * is not a question - a library activity *is* its module, so offering a picker
 * only invited someone to put the breathing pacer on their walk. Custom
 * activities have no session yet and are told so by the absence of the switch.
 *
 * In the app rather than in the design package because the registry is: a
 * component library that had to know breathing has patterns would gain a new
 * import every time a module did.
 */

export interface ModuleDraft {
  /** Which library activity this is. Identity, and never cleared by the
   *  switch - see the schema note on `sessionEnabled`. */
  presetKey: string | null;
  sessionEnabled: boolean;
  startPolicy: StartPolicy;
  /** The module's own settings, as the JSON text that is stored. */
  configJson: string | null;
}

const POLICIES: readonly { value: StartPolicy; label: string }[] = [
  { value: "manual", label: "I start it" },
  { value: "auto", label: "On its own" },
  { value: "prompt", label: "Ask me" },
];

const POLICY_NOTES: Record<StartPolicy, string> = {
  manual: "Waits for you, then moves to the next gap if you do not start it.",
  auto: "Runs and finishes itself. Best for anything short.",
  prompt: "Notifies you, and moves on if you do not answer.",
};

/**
 * The Notifications pane of System Settings.
 *
 * The pane's own extension identifier, read off the bundle in
 * `/System/Library/ExtensionKit/Extensions` - the pre-Ventura name for it
 * (`com.apple.preference.notifications`) is a preference pane that no longer
 * exists, which is why the link opened nothing.
 *
 * ponytail: macOS only. The switch that shows this row is a desktop concern
 * anyway; give it a per-platform URL when there is a second platform to have
 * an opinion about.
 */
const NOTIFICATION_SETTINGS =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

/** Said out loud when the link cannot be opened - on the web, or if macOS
 *  refuses the scheme. A dead link that stays silent reads as a broken app. */
const openSettings = (): void => {
  void openExternal(NOTIFICATION_SETTINGS).then((opened) => {
    if (!opened) {
      notify("Open System Settings › Notifications, then find Wise Routine.");
    }
  });
};

export const ActivityModuleFields: React.FC<{
  value: ModuleDraft;
  onChange: (next: ModuleDraft) => void;
}> = ({ value, onChange }) => {
  const module = moduleFor(value.presetKey);

  // A custom activity is a plain timed slot and has nothing to configure here.
  // Offering a switch that only ever says "off" would be a worse answer than
  // saying nothing.
  if (!module) return null;

  const Config = value.sessionEnabled ? module.Config : undefined;

  return (
    <>
      <div className="wr-field">
        {/* `SwitchRow` rather than a bare `Toggle`: that one carries its label
            only as an aria-label, so a sighted user got an unlabelled switch. */}
        <SwitchRow
          title={`${module.name} session`}
          checked={value.sessionEnabled}
          onChange={(sessionEnabled) => onChange({ ...value, sessionEnabled })}
        />
        {/* Both halves, always. This used to describe only the state the
            switch was already in, which told you what you had just done
            rather than what you were choosing - and left the off state
            undescribed until you turned it off. */}
        <p className="wr-activity-hint">
          When this is on, {module.blurb}. When it is off, {module.name} is just
          a slot on your day and nothing takes over the screen.
        </p>
      </div>

      {Config ? (
        <div className="wr-field">
          <Config
            value={configFor(module, value.configJson)}
            onChange={(next: unknown) =>
              onChange({ ...value, configJson: JSON.stringify(next) })
            }
          />
        </div>
      ) : null}

      <div className="wr-field">
        <span className="wr-label">How it starts</span>
        <Segmented
          label="How it starts"
          options={POLICIES}
          value={value.startPolicy}
          onChange={(startPolicy) => onChange({ ...value, startPolicy })}
        />
        <p className="wr-activity-hint">
          {POLICY_NOTES[value.startPolicy]}
          {value.startPolicy === "prompt" ? (
            <>
              {" Needs notifications turned on — "}
              <button
                type="button"
                className="wr-linklike"
                onClick={openSettings}
              >
                open Notification settings
              </button>
              .
            </>
          ) : null}
        </p>
      </div>
    </>
  );
};
