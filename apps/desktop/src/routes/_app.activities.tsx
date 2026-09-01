import { createFileRoute } from "@tanstack/react-router";
import {
  ACTIVITY_LIBRARY,
  type ActivityDraft,
  ActivityForm,
  ActivityLibrary,
  ActivityRow,
  type ActivityTemplate,
  Button,
  Card,
  daysLabel,
  EVERY_DAY,
  Loading,
  Modal,
  PlanNote,
} from "@wiseroutine/design";
import { PLANS } from "@wiseroutine/plans";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "../lib/account";
import { type ActivityResponse, ApiError, api } from "../lib/api";
import { notify } from "../lib/notify";
import { moduleFor, type StartPolicy } from "../modules/activities";
import {
  ActivityModuleFields,
  type ModuleDraft,
} from "../modules/activity-module-fields";

/**
 * The activities the day is built out of.
 *
 * Two halves, in the order the design puts them: a library of starting points,
 * and the full form behind whichever one is picked. Nothing in the library
 * exists until it is added - it is a palette, not a list of things you have.
 *
 * The form is a sheet rather than a third block on the page. Configuring one
 * activity is a job with an end, and leaving the library and the list live
 * behind it invited exactly the mistake it looks like it invites: picking a
 * second template halfway through filling in the first.
 *
 * Pausing is deliberately not offered yet - see `Yours` below.
 */

/** Where the two named landings aim. Mid-morning and mid-afternoon rather than
 *  the edges, because the planner clamps a preference into the nearest gap and
 *  aiming at 09:00 just means "first thing" for everyone who picks it. */
const MORNING_MINUTES = 10 * 60;
const AFTERNOON_MINUTES = 14 * 60;

const landingOf = (windows: readonly number[]): ActivityDraft["land"] => {
  const first = windows[0];
  if (first === undefined) return "any";
  return first < 12 * 60 ? "morning" : "afternoon";
};

const windowsOf = (land: ActivityDraft["land"]): number[] =>
  land === "morning"
    ? [MORNING_MINUTES]
    : land === "afternoon"
      ? [AFTERNOON_MINUTES]
      : [];

/**
 * A stored activity as the form holds it.
 *
 * `perDay` only means anything for a `countPerDay` minimum. The other two -
 * two hours of deep work a day, a walk three times a week - are read back as
 * "once" rather than mistranslated, and saving turns them into a count. The
 * form offers one cadence, so it must not pretend to round-trip the others.
 */
const draftOf = (row: ActivityResponse): ActivityDraft => ({
  name: row.name,
  kind: row.kind,
  sessionMinutes: row.sessionMinutes,
  perDay: row.minimum.type === "countPerDay" ? row.minimum.value : 1,
  days: row.daysOfWeek,
  land: landingOf(row.preferredWindows),
});

const EMPTY: ActivityDraft = {
  name: "",
  kind: "recovery",
  sessionMinutes: 10,
  perDay: 3,
  days: EVERY_DAY,
  land: "any",
};

const moduleDraftOf = (row: ActivityResponse): ModuleDraft => ({
  presetKey: row.presetKey ?? null,
  sessionEnabled: row.sessionEnabled !== false,
  startPolicy: (row.startPolicy ?? "manual") as StartPolicy,
  configJson: row.configJson ?? null,
});

/** A custom activity: a plain timed slot, and no behaviour to configure. */
const NO_MODULE: ModuleDraft = {
  presetKey: null,
  sessionEnabled: false,
  startPolicy: "manual",
  configJson: null,
};

/**
 * The module a library pick starts with.
 *
 * By template key rather than by name, because a template can be renamed the
 * moment it is picked and matching on the new name would silently drop the
 * module. Anything not listed starts as a plain timed slot, which is the
 * honest default for something the app has no session for.
 */
const LIBRARY_MODULES: Record<string, string> = {
  "shoulder-stretch": "stretch",
  "eye-rest": "eye_rest",
  "deep-work": "deep_work",
  // Namespaced, because breathing is an addon now - the app's own, installed
  // the way any other would be. If it is not installed, `moduleFor` returns
  // undefined and the template falls through to `NO_MODULE`, which is the same
  // answer "walk" and "water" already get: a plain timed slot.
  breathing: "wiseroutine.breathing/pacer",
};

function moduleForTemplate(key: string): ModuleDraft {
  const module = moduleFor(LIBRARY_MODULES[key]);
  if (!module) return NO_MODULE;
  return {
    presetKey: module.key,
    sessionEnabled: true,
    startPolicy: module.defaults.startPolicy,
    configJson: JSON.stringify(module.defaults.config),
  };
}

/** What the sheet is currently editing, and which of the two jobs it is. */
interface Editing {
  draft: ActivityDraft;
  /** Kept beside the draft rather than inside it: `ActivityDraft` is the
   *  design package's type, and modules are the app's business. */
  module: ModuleDraft;
  /** Set for a library pick, so the name is the template's rather than typed. */
  origin?: string;
  /** Set when this is an existing activity rather than a new one. It is what
   *  decides every label in the sheet: Update against Add. */
  id?: string;
}

const howOften = (row: ActivityResponse): string => {
  const { type, value } = row.minimum;
  if (type === "durationPerDay") return `${value} min a day`;
  if (type === "countPerWeek") return `${value} × week`;
  return `${value} × day`;
};

const LANDING_WORD: Record<ActivityDraft["land"], string> = {
  any: "any working hour",
  morning: "mornings",
  afternoon: "afternoons",
};

const Activities: React.FC = () => {
  const account = useAccount();
  const plan = account?.plan === "pro" ? "pro" : "free";
  const limit = PLANS[plan].maxActiveActivities;

  const [rows, setRows] = useState<readonly ActivityResponse[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  /** The row whose Remove is in flight, so one row's spinner cannot appear on
   *  another's buttons. */
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .activities()
      .then((response) => {
        setRows(response);
        setProblem(null);
      })
      .catch(() => setProblem("Couldn't load your activities."));
  }, []);

  useEffect(load, [load]);

  const active = rows?.filter((row) => row.isActive).length ?? 0;
  const atLimit = active >= limit;

  /**
   * Saving does not touch today.
   *
   * It used to re-plan straight after, so adding an activity in the morning
   * meant walking back to Today and finding it already on the day. That is
   * the one thing placement is not supposed to do: the day is filled once, at
   * the start of it, and anything added afterwards is offered by the "To
   * place today" module with a button, rather than arranged behind your back.
   */
  const save = () => {
    if (!editing) return;
    const { draft, id } = editing;
    const input = {
      name: draft.name.trim(),
      kind: draft.kind,
      minimumType: "countPerDay" as const,
      minimumValue: draft.perDay,
      sessionMinutes: draft.sessionMinutes,
      daysOfWeek: draft.days,
      preferredWindows: windowsOf(draft.land),
      presetKey: editing.module.presetKey,
      sessionEnabled: editing.module.sessionEnabled,
      startPolicy: editing.module.startPolicy,
      configJson: editing.module.configJson,
    };

    setSaving(true);
    setProblem(null);
    const request = id
      ? api.updateActivity(id, input)
      : api.createActivity(input);

    request
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((cause: unknown) => {
        // The server's own two sentences, verbatim - it is the one that knows
        // which limit was hit and what the way out is.
        const refusal = cause instanceof ApiError ? cause.planLimit : undefined;
        setProblem(
          refusal
            ? `${refusal.reason} ${refusal.upsell}`
            : "Couldn't save that activity. Try again.",
        );
      })
      .finally(() => setSaving(false));
  };

  const remove = (id: string) => {
    setWorking(id);
    api
      .removeActivity(id)
      .then(() => {
        load();
      })
      .catch(() => notify("Couldn't remove that activity. Try again."))
      .finally(() => setWorking(null));
  };

  const pick = (template: ActivityTemplate | null) => {
    setProblem(null);
    setEditing(
      template
        ? {
            draft: {
              name: template.name,
              kind: template.kind,
              sessionMinutes: template.sessionMinutes,
              perDay: template.perDay,
              days: template.days,
              land: template.land,
            },
            module: moduleForTemplate(template.key),
            origin: "From the library · change anything",
          }
        : { draft: EMPTY, module: NO_MODULE },
    );
  };

  if (!rows) {
    return <Loading>{problem ?? "Loading your activities…"}</Loading>;
  }

  return (
    <div className="wr-settings wr-page-scroll">
      <section className="wr-settings-section">
        <h2 className="wr-settings-title">Activities</h2>

        {rows.length > 0 ? (
          // No Pause here yet. The free limit counts active activities, so
          // pausing is a real way to swap one out - but it is going to be a
          // Pro capability, and shipping it to everyone first and taking it
          // away later is the one order that cannot be done kindly. Remove is
          // the way out until then; the kit still carries the control.
          <Card
            title="Yours"
            note="Each one is placed into the gaps your calendar leaves, on the days you picked."
          >
            {rows.map((row) => (
              <ActivityRow
                key={row.id}
                name={row.name}
                meta={`${row.sessionMinutes} min · ${howOften(row)} · ${daysLabel(
                  row.daysOfWeek,
                )} · ${LANDING_WORD[landingOf(row.preferredWindows)]}`}
                isActive={row.isActive}
                busy={working === row.id}
                onEdit={() =>
                  setEditing({
                    draft: draftOf(row),
                    module: moduleDraftOf(row),
                    id: row.id,
                  })
                }
                onRemove={() => remove(row.id)}
              />
            ))}
          </Card>
        ) : null}
      </section>

      <section className="wr-settings-section">
        <ActivityLibrary
          templates={ACTIVITY_LIBRARY}
          {...(Number.isFinite(limit)
            ? { used: `${active} of ${limit} used` }
            : {})}
          // At the limit the whole palette greys out rather than each pick
          // being refused after the fact - the answer is the same for all of
          // them, so it belongs on the group.
          disabled={atLimit}
          onPick={pick}
        />

        {/* Only free ever reaches a limit, so there is only one note. Pro's
            caveat - that a busy day may not fit them all - belongs on the form
            instead, which is the moment someone is about to add another. */}
        {atLimit ? (
          <div style={{ marginTop: 14 }}>
            <PlanNote title="Free keeps two active at a time">
              Remove one you are not using to make room, or move to Pro for as
              many as you like.
            </PlanNote>
          </div>
        ) : null}

        {problem && !editing ? (
          <p className="wr-auth-problem" role="alert" style={{ marginTop: 12 }}>
            {problem}
          </p>
        ) : null}
      </section>

      {editing ? (
        <Modal
          // The activity names itself. "Edit activity" over a form whose first
          // line is the activity's name says nothing the form does not.
          title={editing.draft.name || "New activity"}
          subtitle={
            editing.id
              ? "Changes apply to the rest of today as soon as you save."
              : (editing.origin ??
                "Describe it, and it gets placed into the gaps your calendar leaves.")
          }
          onClose={() => {
            setEditing(null);
            setProblem(null);
          }}
          footer={
            <>
              <Button
                variant="primary"
                // A nameless activity and one that runs on no day are the two
                // that can never be placed. The server refuses both; this only
                // saves the user finding that out from a round trip.
                disabled={
                  saving ||
                  editing.draft.name.trim() === "" ||
                  editing.draft.days === 0
                }
                onClick={save}
              >
                {editing.id ? "Update" : "Add"}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setEditing(null);
                  setProblem(null);
                }}
              >
                Cancel
              </Button>
              {/* Only on the way in. Editing one you already have costs
                  nothing, so there is nothing to say about the plan. */}
              {editing.id ? null : (
                <span className="wr-activity-note">
                  {plan === "free"
                    ? "Free covers two. A third asks you to swap one out or move to Pro."
                    : "Pro does not limit these. A really busy day may still not fit them all."}
                </span>
              )}
            </>
          }
        >
          <ActivityForm
            draft={editing.draft}
            named={editing.origin !== undefined}
            onChange={(draft) => setEditing({ ...editing, draft })}
          >
            <ActivityModuleFields
              value={editing.module}
              onChange={(module) => setEditing({ ...editing, module })}
            />
          </ActivityForm>
          {problem ? (
            <p
              className="wr-auth-problem"
              role="alert"
              style={{ marginTop: 12 }}
            >
              {problem}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/activities")({
  component: Activities,
});
