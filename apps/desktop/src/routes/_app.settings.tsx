import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AccountScreen,
  type DayHoursBlock,
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
import {
  ApiError,
  api,
  deviceTimeZone,
  OfflineError,
  type SettingsPatch,
} from "../lib/api";
import { notify } from "../lib/notify";

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
    api
      .updateName(next)
      .then(() => {
        // One write, both screens: the rail re-renders from the same store.
        patchAccount({ name: next });
        setDraftName(next);
      })
      .catch((cause: unknown) =>
        notify(
          cause instanceof OfflineError
            ? "No connection - your name wasn't saved."
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
          onDraftNameChange={setDraftName}
          onSaveName={saveName}
          onCancelName={() => setDraftName(name)}
          savingName={savingName}
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
            api.setTimeZone(zone).catch(() => {
              if (previous) patchAccount({ timeZone: previous });
              notify("Couldn't change your time zone. Try again.");
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
 * The day view's hours.
 *
 * Its own component so the draft can be seeded from an account that only
 * exists after the layout's session call lands - a hook in the parent would
 * have to hold a nullable draft and re-seed it, which is the shape that lets a
 * half-typed value survive a re-render as if it were saved.
 *
 * Two ways to save, and which one a setting gets is decided by its control.
 * See `DayHoursSection` for why; this side is where the optimism lives.
 */
const DayHours: React.FC<{ account: Account }> = ({ account }) => {
  const saved = draftFrom(account);
  const [draft, setDraft] = useState<DayHoursDraft>(saved);
  const [saving, setSaving] = useState<DayHoursBlock | null>(null);

  /** The three custom columns, as `PATCH /settings` wants them: all set, or
   *  all null. A label with no hours is not a range the picker can offer. */
  const asPatch = (next: DayHoursDraft): SettingsPatch => ({
    dayStartMinutes: next.dayStartMinutes,
    dayEndMinutes: next.dayEndMinutes,
    customRangeLabel: next.custom?.label.trim() ?? null,
    customRangeStartMinutes: next.custom?.startMinutes ?? null,
    customRangeEndMinutes: next.custom?.endMinutes ?? null,
    dayOpensOn: next.dayOpensOn,
    showOutsideRange: next.showOutsideRange,
  });

  /** What the store has to learn for Today to open on the right range. */
  const remember = (next: DayHoursDraft) =>
    patchAccount({
      dayStartMinutes: next.dayStartMinutes,
      dayEndMinutes: next.dayEndMinutes,
      customRangeLabel: next.custom?.label.trim() ?? null,
      customRangeStartMinutes: next.custom?.startMinutes ?? null,
      customRangeEndMinutes: next.custom?.endMinutes ?? null,
      dayOpensOn: next.dayOpensOn,
      showOutsideRange: next.showOutsideRange,
    });

  const excuse = (cause: unknown): string =>
    cause instanceof OfflineError
      ? "No connection - that setting wasn't saved."
      : cause instanceof ApiError && cause.status === 400
        ? // The server's own words: it knows which window was inverted, and
          // "try again" would not tell the user what to fix.
          ((cause.body as { message?: string }).message ??
          "Those hours don't make a range.")
        : "Couldn't save that setting. Try again.";

  /**
   * A control that is itself the decision - a toggle, a segmented choice.
   *
   * Applied on screen before the request, because the switch has already
   * moved and holding the old state until the server agrees makes every click
   * feel broken. A refusal puts it back and says so, which is the only honest
   * way round: the screen must never keep showing a setting the server
   * rejected.
   */
  const commit = (patch: Partial<DayHoursDraft>) => {
    const next = { ...draft, ...patch };
    const previous = saved;
    setDraft(next);
    remember(next);

    api.updateSettings(asPatch(next)).catch((cause: unknown) => {
      setDraft(previous);
      remember(previous);
      notify(excuse(cause));
    });
  };

  /** A typed value, committed on purpose. Not optimistic: the user is looking
   *  at the button they just pressed, so the button is where the wait shows. */
  const save = (block: DayHoursBlock) => {
    setSaving(block);
    api
      .updateSettings(asPatch(draft))
      .then(() => remember(draft))
      // The draft is left alone on failure - the typed values stay on screen,
      // the same promise the calendars page makes about unsaved ticks.
      .catch((cause: unknown) => notify(excuse(cause)))
      .finally(() => setSaving(null));
  };

  return (
    <DayHoursSection
      saved={saved}
      draft={draft}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      onCommit={commit}
      onSave={save}
      onCancel={() => setDraft(saved)}
      saving={saving}
    />
  );
};

export const Route = createFileRoute("/_app/settings")({ component: Settings });
