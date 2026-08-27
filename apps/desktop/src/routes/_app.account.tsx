import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AccountScreen,
  type LinkedAccount,
  type SocialProvider,
} from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import { patchAccount, setAccount, useAccount } from "../lib/account";
import { ApiError, api, deviceTimeZone, OfflineError } from "../lib/api";

/**
 * Every zone this runtime knows, for the picker.
 *
 * `supportedValuesOf` is recent enough to be worth guarding: an older runtime
 * gets an empty list, and the screen falls back to offering just the saved
 * zone and this device's — which is the choice almost everyone needs anyway.
 */
function timeZoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/**
 * The account page.
 *
 * Wiring only — the composition is `AccountScreen` in the kit. Everything here
 * goes through Better Auth's own endpoints; there is no route of ours in front
 * of them because there is nothing of ours to add.
 */

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

const Account: React.FC = () => {
  const navigate = useNavigate();

  // The rail shows the same name and this page can change it, so neither owns
  // it — see lib/account. Saving here updates the rail with no refetch.
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

  /** Only the provider list — the identity is already in the store, put there
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
          // Unlinking sits behind a *fresh* session — Better Auth will not let
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
    <AccountScreen
      email={email}
      name={name}
      avatarUrl={account?.avatarUrl ?? null}
      draftName={draftName}
      onDraftNameChange={(value) => {
        setDraftName(value);
        // "Saved" describes the value in the field. The moment it changes it
        // is describing something that is no longer true.
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
  );
};

export const Route = createFileRoute("/_app/account")({ component: Account });
