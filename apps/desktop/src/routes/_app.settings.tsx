import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AccountScreen,
  type DayHoursDraft,
  DayHoursSection,
  type LinkedAccount,
  type SocialProvider,
} from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import {
  type Account,
  patchAccount,
  setAccount,
  useAccount,
} from "../lib/account";
import { ApiError, api, deviceTimeZone, OfflineError } from "../lib/api";

/**
 * Every zone this runtime knows, for the picker.
 *
 * `supportedValuesOf` is recent enough to be worth guarding: an older runtime
 * gets an empty list, and the screen falls back to offering just the saved
 * zone and this device's - which is the choice almost everyone needs anyway.
 */
function timeZoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/**
 * Settings.
 *
 * Wiring only - both compositions are in the kit. Sections rather than one
 * long form, because "Edit hours and ranges" on Today has to land somewhere
 * specific: an anchor the popover can send someone to is the whole reason this
 * page has headings at all.
 */

/** The id the day view's popover links to. Shared with the Today page through
 *  the URL hash, so both spell it once. */
export const DAY_HOURS_ANCHOR = "day-view-hours";

/** The other section. A constant only so the anchor is written once - these
 *  are link targets, so `useId` is exactly the wrong tool: the whole point is
 *  that the value is the same one the day view links to. */
const ACCOUNT_ANCHOR = "account";

/** Better Auth namespaces non-OAuth accounts (`local:credential`), and we only
 *  render the two we actually offer. Anything else is not a sign-in button the
 *  user ever pressed, so it is not a row they can act on. */
const asProvider = (providerId: string): SocialProvider | null =>
  providerId === "google" || providerId === "microsoft" ? providerId : null;

const connectedOn = (iso: string): string | undefined => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? undefined
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(at);
};

/** The account's day-view hours as the section edits them. The three custom
 *  columns collapse into one nullable object, because that is what they are. */
const draftFrom = (account: Account): DayHoursDraft => ({
  dayStartMinutes: account.dayStartMinutes,
  dayEndMinutes: account.dayEndMinutes,
  custom:
    account.customRangeLabel !== null &&
    account.customRangeStartMinutes !== null &&
    account.customRangeEndMinutes !== null
      ? {
          label: account.customRangeLabel,
          startMinutes: account.customRangeStartMinutes,
          endMinutes: account.customRangeEndMinutes,
        }
      : null,
  dayOpensOn: account.dayOpensOn,
  showOutsideRange: account.showOutsideRange,
});

const Settings: React.FC = () => {
  const navigate = useNavigate();

  // The rail shows the same name and this page can change it, so neither owns
  // it - see lib/account. Saving here updates the rail with no refetch.
  const account = useAccount();
  const name = account?.name ?? "";
  const email = account?.email ?? "";

  const [draftName, setDraftName] = useState(name);
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);

  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Computed once: the list is ~450 strings and never changes at runtime.
  const [zones] = useState(timeZoneOptions);
  const device = deviceTimeZone();

  /** Only the provider list - the identity is already in the store, put there
   *  by the layout that guards this route. */
  const load = useCallback(async () => {
    const linked = await api.listAccounts();
    setAccounts(
      linked.flatMap((row) => {
        const provider = asProvider(row.providerId);
        if (!provider) return [];
        const connectedAt = connectedOn(row.createdAt);
        return [
          {
            id: row.id,
            provider,
            ...(connectedAt !== undefined ? { connectedAt } : {}),
          },
        ];
      }),
    );
  }, []);

  useEffect(() => {
    void load().catch(() => setProblem("Couldn't load your sign-in methods."));
  }, [load]);

  // The store fills in a moment after mount. Adopt the saved name as the draft
  // once, without clobbering anything the user has started typing.
  useEffect(() => {
    setDraftName((draft) => (draft === "" ? name : draft));
  }, [name]);

  /**
   * Arrive at the section the popover asked for.
   *
   * The store fills in after mount and the section only renders once it has,
   * so scrolling on mount alone lands on a page that is still a paragraph
   * tall. Keyed on the account instead: by the time there is one, the heading
   * exists to scroll to.
   */
  useEffect(() => {
    if (!account || globalThis.location?.hash !== `#${DAY_HOURS_ANCHOR}`)
      return;
    document
      .getElementById(DAY_HOURS_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [account]);

  const saveName = () => {
    const next = draftName.trim();
    setSavingName(true);
    setProblem(null);
    api
      .updateName(next)
      .then(() => {
        // One write, both screens: the rail re-renders from the same store.
        patchAccount({ name: next });
        setDraftName(next);
        setNameSaved(true);
      })
      .catch((cause: unknown) =>
        setProblem(
          cause instanceof OfflineError
            ? "No connection. Your name wasn't saved."
            : "Couldn't save that name. Try again.",
        ),
      )
      .finally(() => setSavingName(false));
  };

  const disconnect = (account: LinkedAccount) => {
    setDisconnecting(account.id);
    setProblem(null);
    api
      .unlinkAccount(account.id)
      .then(load)
      .catch((cause: unknown) =>
        setProblem(
          // Unlinking sits behind a *fresh* session - Better Auth will not let
          // a session days old detach a sign-in method, which is the right
          // call and a confusing 400 if we pass it through verbatim.
          cause instanceof ApiError && cause.status === 400
            ? "For safety this needs a recent sign-in. Sign out, sign back in, then disconnect."
            : "Couldn't disconnect that account. Try again.",
        ),
      )
      .finally(() => setDisconnecting(null));
  };

  return (
    <div className="wr-settings wr-page-scroll">
      <section id={ACCOUNT_ANCHOR} className="wr-settings-section">
        <h2 className="wr-settings-title">Account</h2>
        <AccountScreen
          email={email}
          name={name}
          avatarUrl={account?.avatarUrl ?? null}
          draftName={draftName}
          onDraftNameChange={(value) => {
            setDraftName(value);
            // "Saved" describes the value in the field. The moment it changes
            // it is describing something that is no longer true.
            if (nameSaved) setNameSaved(false);
          }}
          onSaveName={saveName}
          savingName={savingName}
          nameSaved={nameSaved}
          accounts={accounts}
          onDisconnect={disconnect}
          disconnecting={disconnecting}
          {...(account?.timeZone ? { timeZone: account.timeZone } : {})}
          timeZoneOptions={zones}
          deviceTimeZone={device}
          onTimeZoneChange={(zone) => {
            // Optimistic: the picker should not lag behind the click. A refusal
            // puts the old value back, so the screen never claims a zone the
            // server rejected.
            const previous = account?.timeZone;
            patchAccount({ timeZone: zone });
            setProblem(null);
            api.setTimeZone(zone).catch(() => {
              if (previous) patchAccount({ timeZone: previous });
              setProblem("Couldn't change your time zone. Try again.");
            });
          }}
          onSignOut={() => {
            setAccount(null);
            void api.signOut().then(() => navigate({ to: "/signin" }));
          }}
          problem={problem}
        />
      </section>

      <section id={DAY_HOURS_ANCHOR} className="wr-settings-section">
        <h2 className="wr-settings-title">Day view hours</h2>
        {account ? <DayHours account={account} /> : null}
      </section>
    </div>
  );
};

/**
 * The day view's hours, edited as a draft.
 *
 * Its own component so the draft can be seeded from an account that only
 * exists after the layout's session call lands - a hook in the parent would
 * have to hold a nullable draft and re-seed it, which is the shape that lets a
 * half-typed value survive a re-render as if it were saved.
 *
 * Update/Cancel rather than saving each control, the same as Calendars. Hours
 * are typed rather than toggled, so every keystroke would otherwise be a write
 * and a replan on its way to the value the user meant.
 */
const DayHours: React.FC<{ account: Account }> = ({ account }) => {
  const saved = draftFrom(account);
  const [draft, setDraft] = useState<DayHoursDraft>(saved);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * "Is there anything to update?" as a comparison, not a flag.
   *
   * The same reasoning as the calendars page: a boolean somebody has to
   * remember to set goes stale the first time a control is added, whereas this
   * cannot - and Cancel becomes throwing the draft away rather than undoing a
   * list of changes. Structural equality by serialising: the draft is five
   * scalars and one small object, so this is cheaper than the render it guards.
   */
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const update = () => {
    setSaving(true);
    setProblem(null);
    api
      .updateSettings({
        dayStartMinutes: draft.dayStartMinutes,
        dayEndMinutes: draft.dayEndMinutes,
        // All three or none - a label without hours is not a range the picker
        // can offer, and the server refuses the halfway state.
        customRangeLabel: draft.custom?.label.trim() ?? null,
        customRangeStartMinutes: draft.custom?.startMinutes ?? null,
        customRangeEndMinutes: draft.custom?.endMinutes ?? null,
        dayOpensOn: draft.dayOpensOn,
        showOutsideRange: draft.showOutsideRange,
      })
      .then(() => {
        // One write, and the store is what Today reads its defaults from.
        patchAccount({
          dayStartMinutes: draft.dayStartMinutes,
          dayEndMinutes: draft.dayEndMinutes,
          customRangeLabel: draft.custom?.label.trim() ?? null,
          customRangeStartMinutes: draft.custom?.startMinutes ?? null,
          customRangeEndMinutes: draft.custom?.endMinutes ?? null,
          dayOpensOn: draft.dayOpensOn,
          showOutsideRange: draft.showOutsideRange,
        });
      })
      .catch((cause: unknown) =>
        setProblem(
          cause instanceof OfflineError
            ? "No connection. Your hours weren't saved."
            : cause instanceof ApiError && cause.status === 400
              ? // The server's own words: it knows which of the two windows was
                // inverted, and "try again" would not tell the user what to fix.
                ((cause.body as { message?: string }).message ??
                "Those hours don't make a range.")
              : "Couldn't save those hours. Try again.",
        ),
      )
      .finally(() => setSaving(false));
  };

  return (
    <DayHoursSection
      draft={draft}
      onChange={(patch) => {
        setDraft((current) => ({ ...current, ...patch }));
        setProblem(null);
      }}
      dirty={dirty}
      onUpdate={update}
      onCancel={() => {
        setDraft(saved);
        setProblem(null);
      }}
      saving={saving}
      problem={problem}
    />
  );
};

export const Route = createFileRoute("/_app/settings")({ component: Settings });
