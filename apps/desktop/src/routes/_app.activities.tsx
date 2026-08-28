import { createFileRoute } from "@tanstack/react-router";
import {
  ACTIVITY_LIBRARY,
  type ActivityDraft,
  ActivityForm,
  ActivityLibrary,
  ActivityRow,
  type ActivityTemplate,
  Card,
  PlanNote,
} from "@wiseroutine/design";
import { PLANS } from "@wiseroutine/plans";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "../lib/account";
import { type ActivityResponse, ApiError, api } from "../lib/api";
import { notify } from "../lib/notify";

/**
 * The activities the day is built out of.
 *
 * Two halves, in the order the design puts them: a library of starting points,
 * and the full form behind whichever one is picked. Nothing in the library
 * exists until it is added - it is a palette, not a list of things you have.
 *
 * The free plan's limit is on *active* activities, so pausing frees a place.
 * That is why the row offers Pause before Remove: swapping is the intended
 * move at the limit, and removing is the irreversible one.
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
  land: landingOf(row.preferredWindows),
});

const EMPTY: ActivityDraft = {
  name: "",
  kind: "recovery",
  sessionMinutes: 10,
  perDay: 3,
  land: "any",
};

/** What the form is currently editing, and where it came from. */
interface Editing {
  draft: ActivityDraft;
  /** Set for a library pick, so the name is the template's rather than typed. */
  origin?: string;
  /** Set when this is an existing activity rather than a new one. */
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
  /** The row whose Pause or Remove is in flight, so one row's spinner cannot
   *  appear on another's buttons. */
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

  /**
   * Re-plan the day, quietly.
   *
   * Adding an activity that never appears on Today is the whole feature
   * failing, so this runs after every change. It is deliberately not awaited
   * into the button's spinner: the activity is saved either way, and a
   * planner that is briefly behind is not a failed save.
   */
  const replan = () => {
    void api.plan().catch(() => undefined);
  };

  const active = rows?.filter((row) => row.isActive).length ?? 0;
  const atLimit = active >= limit;

  const save = () => {
    if (!editing) return;
    const { draft, id } = editing;
    const input = {
      name: draft.name.trim(),
      kind: draft.kind,
      minimumType: "countPerDay" as const,
      minimumValue: draft.perDay,
      sessionMinutes: draft.sessionMinutes,
      preferredWindows: windowsOf(draft.land),
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
        replan();
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

  const act = (id: string, run: Promise<unknown>, failure: string) => {
    setWorking(id);
    run
      .then(() => {
        load();
        replan();
      })
      .catch((cause: unknown) => {
        const refusal = cause instanceof ApiError ? cause.planLimit : undefined;
        notify(refusal ? `${refusal.reason} ${refusal.upsell}` : failure);
      })
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
              land: template.land,
            },
            origin: "From the library · change anything",
          }
        : { draft: EMPTY },
    );
  };

  if (!rows) {
    return <p className="wr-body">{problem ?? "Loading your activities…"}</p>;
  }

  return (
    <div className="wr-settings wr-page-scroll">
      <section className="wr-settings-section">
        <h2 className="wr-settings-title">Activities</h2>

        {rows.length > 0 ? (
          <Card
            title="Yours"
            note="Pausing one frees a place without losing what it has already done."
          >
            {rows.map((row) => (
              <ActivityRow
                key={row.id}
                name={row.name}
                meta={`${row.sessionMinutes} min · ${howOften(row)} · ${
                  LANDING_WORD[landingOf(row.preferredWindows)]
                }`}
                isActive={row.isActive}
                busy={working === row.id}
                onEdit={() => setEditing({ draft: draftOf(row), id: row.id })}
                onToggle={() =>
                  act(
                    row.id,
                    api.updateActivity(row.id, { isActive: !row.isActive }),
                    "Couldn't change that activity. Try again.",
                  )
                }
                onRemove={() =>
                  act(
                    row.id,
                    api.removeActivity(row.id),
                    "Couldn't remove that activity. Try again.",
                  )
                }
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
        {atLimit && editing === null ? (
          <div style={{ marginTop: 14 }}>
            <PlanNote title="Free keeps two active at a time">
              Pause one you are not using to make room, or move to Pro for as
              many as you like.
            </PlanNote>
          </div>
        ) : null}

        {editing ? (
          <div style={{ marginTop: 14 }}>
            <ActivityForm
              draft={editing.draft}
              {...(editing.origin ? { origin: editing.origin } : {})}
              submitLabel={editing.id ? "Save changes" : "Add activity"}
              busy={saving}
              note={
                editing.id
                  ? "Changes apply to the rest of today when the day is next planned."
                  : plan === "free"
                    ? "Free covers two. A third asks you to swap one out or move to Pro."
                    : "Pro does not limit these. A really busy day may still not fit them all."
              }
              onChange={(draft) => setEditing({ ...editing, draft })}
              onSubmit={save}
              onCancel={() => {
                setEditing(null);
                setProblem(null);
              }}
            />
          </div>
        ) : null}

        {problem ? (
          <p className="wr-auth-problem" role="alert" style={{ marginTop: 12 }}>
            {problem}
          </p>
        ) : null}
      </section>
    </div>
  );
};

export const Route = createFileRoute("/_app/activities")({
  component: Activities,
});
