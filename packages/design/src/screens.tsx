import type React from "react";
import {
  Avatar,
  Button,
  Chip,
  ClashRow,
  CodeInput,
  DashedRow,
  DragPlacement,
  Field,
  FitStrip,
  LiveStatus,
  Metric,
  Module,
  ModuleEmpty,
  PlanNote,
  PROVIDER_NAMES,
  ProviderButton,
  Rule,
  SelectField,
  Slot,
  TimeStepper,
} from "./components";
import { AppFrame, AuthFrame, PageHead, Sidebar, UserMenu } from "./layout";

/**
 * The collection: whole screens, composed only from the kit.
 *
 * Nothing here introduces a surface, a colour or an elevation of its own — if
 * a screen needs something the components cannot express, that is a gap in the
 * components, not licence to style it locally. Keeping that rule is what makes
 * these useful as a check rather than decoration.
 *
 * Each screen takes the props a real one would, so the same composition can be
 * driven by fixtures here and by the API in the app.
 */

const NAV = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "activities", label: "Activities" },
  { key: "reminders", label: "Reminders", count: 3 },
  { key: "calendars", label: "Calendars" },
] as const;

export interface ScreenUser {
  name: string;
  email?: string;
  plan?: "free" | "pro";
}

const DEFAULT_USER: ScreenUser = {
  name: "Mara K.",
  email: "mara@example.com",
  plan: "free",
};

/* ── Getting in ──────────────────────────────────────────────────────────── */

export type SocialProvider = "google" | "microsoft";

/**
 * Sign in.
 *
 * The emailed code is the path the screen is built around — it is the one that
 * needs no provider to have approved us and no tenant administrator to have
 * said yes. Google and Microsoft sit under a rule as alternatives, and the
 * footnote does the work the buttons cannot: signing in with a provider is not
 * connecting that provider's calendar. Those are separate grants with separate
 * scopes, and a user who signs in with Google can go on to sync Outlook.
 */
export const SignInScreen: React.FC<{
  email: string;
  onEmailChange?: (value: string) => void;
  onSubmit?: () => void;
  /** Omit or empty to hide the rule and the buttons entirely — an environment
   *  with no provider credentials must not offer a door that cannot open. */
  providers?: readonly SocialProvider[];
  onProvider?: (provider: SocialProvider) => void;
  /** Sending the emailed code. Only the code path — a provider sign-in must
   *  not make this button claim it is sending anything. */
  busy?: boolean;
  /** Consent is open in a browser and we are waiting for it to come back. */
  waitingFor?: SocialProvider | null;
  onCancelWaiting?: () => void;
  /** Set when the browser could not be opened for us — a popup blocker, or a
   *  webview with no opener. The user can still get there by hand, and a link
   *  they can click is the difference between a delay and a dead end. */
  consentUrl?: string | null;
  problem?: string | null;
  chrome?: boolean;
}> = ({
  email,
  onEmailChange,
  onSubmit,
  providers = ["google", "microsoft"],
  onProvider,
  busy,
  waitingFor,
  onCancelWaiting,
  consentUrl,
  problem,
  chrome,
}) => (
  <AuthFrame {...(chrome !== undefined ? { chrome } : {})}>
    <h1 className="wr-display-30 wr-auth-title">Sign in</h1>
    <p className="wr-auth-sub">
      We send a six-digit code to your email. There is no password to set and
      nothing to remember.
    </p>

    <form
      className="wr-auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={(event) => onEmailChange?.(event.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
        required
      />
      {problem ? (
        <p className="wr-auth-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <Button
        variant="primary"
        block
        className="wr-btn-tall"
        type="submit"
        disabled={busy}
      >
        {busy ? "Sending…" : "Email me a code"}
      </Button>
    </form>

    {providers.length > 0 ? (
      <>
        <Rule />
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {providers.map((provider) => (
            <ProviderButton
              key={provider}
              provider={provider}
              // One at a time: a second consent window would race the first
              // for the same account.
              disabled={waitingFor !== null && waitingFor !== undefined}
              {...(waitingFor === provider
                ? { label: `Waiting for ${PROVIDER_NAMES[provider]}…` }
                : {})}
              onClick={() => onProvider?.(provider)}
            />
          ))}
        </div>

        {waitingFor ? (
          <div className="wr-auth-waiting">
            <p>
              {consentUrl
                ? `We couldn't open your browser. Open the ${PROVIDER_NAMES[waitingFor]} page yourself to finish:`
                : `Finish signing in with ${PROVIDER_NAMES[waitingFor]} in your browser, then come back here.`}
            </p>
            {consentUrl ? (
              // Opens in the browser the user is already in; this is the
              // fallback for when we could not open one for them.
              <a
                href={consentUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="wr-auth-consent-link"
              >
                Open the {PROVIDER_NAMES[waitingFor]} sign-in page
              </a>
            ) : null}
            <Button variant="quiet" onClick={onCancelWaiting}>
              Cancel
            </Button>
          </div>
        ) : null}

        <p className="wr-auth-foot">
          Signing in with Google or Microsoft does not connect that calendar —
          you choose calendars separately, after you are in.
        </p>
      </>
    ) : null}
  </AuthFrame>
);

/* ── Account ─────────────────────────────────────────────────────────────── */

export interface LinkedAccount {
  /** Better Auth's account row id — what an unlink is addressed to. */
  id: string;
  provider: SocialProvider;
  /** When the provider was linked. */
  connectedAt?: string;
}

/**
 * The account page.
 *
 * Three questions, three blocks: what we call you, how you get in, and how you
 * leave. Signing in with a provider and syncing that provider's calendar are
 * different grants, and this page is only about the first — the note says so,
 * because "Disconnect Google" here could otherwise read as "stop syncing my
 * Google calendar", which it is not.
 */
export const AccountScreen: React.FC<{
  email: string;
  name: string;
  /** Rendered only when it is an `https:` URL — see `Avatar`. */
  avatarUrl?: string | null;
  /** Draft name in the field, which is not the saved one until it is saved. */
  draftName?: string;
  onDraftNameChange?: (value: string) => void;
  onSaveName?: () => void;
  /** True while a save is in flight; also disables an unchanged save. */
  savingName?: boolean;
  nameSaved?: boolean;
  accounts?: readonly LinkedAccount[];
  onDisconnect?: (account: LinkedAccount) => void;
  disconnecting?: string | null;
  /** IANA zone every preferred window is evaluated in. */
  timeZone?: string;
  timeZoneOptions?: readonly string[];
  onTimeZoneChange?: (zone: string) => void;
  /** This device's zone, offered when it differs from the saved one. */
  deviceTimeZone?: string;
  onSignOut?: () => void;
  problem?: string | null;
}> = ({
  email,
  name,
  avatarUrl,
  draftName,
  onDraftNameChange,
  onSaveName,
  savingName,
  nameSaved,
  accounts = [],
  onDisconnect,
  disconnecting,
  timeZone,
  timeZoneOptions = [],
  onTimeZoneChange,
  deviceTimeZone,
  onSignOut,
  problem,
}) => {
  const draft = draftName ?? name;
  const unchanged = draft.trim() === name.trim();

  return (
    <div className="wr-account">
      <div className="wr-account-id">
        <Avatar
          name={name || email}
          size={44}
          {...(avatarUrl !== undefined ? { src: avatarUrl } : {})}
        />
        <div style={{ minWidth: 0 }}>
          <div className="wr-account-id-name">{name || email}</div>
          <div className="wr-account-id-email">{email}</div>
        </div>
      </div>

      <section className="wr-account-sec">
        <form
          style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
          onSubmit={(event) => {
            event.preventDefault();
            onSaveName?.();
          }}
        >
          <Field
            label="Name"
            value={draft}
            onChange={(event) => onDraftNameChange?.(event.target.value)}
            placeholder="How should we address you?"
            autoComplete="name"
            style={{ flex: 1 }}
          />
          <Button
            variant="commit"
            type="submit"
            disabled={savingName || unchanged}
          >
            {savingName ? "Saving…" : nameSaved && unchanged ? "Saved" : "Save"}
          </Button>
        </form>
        <p className="wr-account-note">
          Providers give us a name when you sign in with them. This overrides
          it.
        </p>
      </section>

      {timeZone ? (
        <section className="wr-account-sec">
          <span className="wr-label">Your day</span>
          <SelectField
            label="Time zone"
            options={
              // Always include the saved value, even if this build of the
              // browser does not list it — otherwise the select silently shows
              // the wrong zone as selected.
              timeZoneOptions.includes(timeZone)
                ? timeZoneOptions
                : [timeZone, ...timeZoneOptions]
            }
            value={timeZone}
            onChange={(event) => onTimeZoneChange?.(event.target.value)}
          />
          {deviceTimeZone && deviceTimeZone !== timeZone ? (
            <div className="wr-account-actions">
              <Button
                variant="secondary"
                onClick={() => onTimeZoneChange?.(deviceTimeZone)}
              >
                Use this device's zone ({deviceTimeZone})
              </Button>
            </div>
          ) : null}
          <p className="wr-account-note">
            Everything is scheduled in this zone — your day's start and end, and
            when each activity is due.
          </p>
        </section>
      ) : null}

      <section className="wr-account-sec">
        <span className="wr-label">How you sign in</span>

        {accounts.length === 0 ? (
          <p className="wr-account-empty">
            A code emailed to <b>{email}</b>. That always works, whether or not
            a provider is connected.
          </p>
        ) : (
          accounts.map((account) => (
            <div className="wr-account-row" key={account.id}>
              <span
                className={`wr-provider-mark${
                  account.provider === "microsoft"
                    ? " wr-provider-microsoft"
                    : ""
                }`}
                aria-hidden="true"
              >
                {account.provider === "google" ? "G" : "M"}
              </span>
              <div className="wr-account-row-main">
                <div className="wr-account-row-name">
                  {PROVIDER_NAMES[account.provider]}
                </div>
                {account.connectedAt ? (
                  <div className="wr-account-row-note">
                    Connected {account.connectedAt}
                  </div>
                ) : null}
              </div>
              <Button
                variant="secondary"
                onClick={() => onDisconnect?.(account)}
                disabled={disconnecting === account.id}
              >
                {disconnecting === account.id ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          ))
        )}

        {problem ? (
          <p className="wr-auth-problem" role="alert">
            {problem}
          </p>
        ) : null}

        <p className="wr-account-note">
          Disconnecting only removes this way of signing in — your calendars
          stay connected, and the emailed code still works.
        </p>
      </section>

      <section className="wr-account-sec">
        <span className="wr-label">This device</span>
        <div className="wr-account-actions">
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </section>
    </div>
  );
};

/** mm:ss, for the resend countdown. */
const countdown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * The code.
 *
 * Three states on one screen because they are the same screen: waiting, wrong,
 * and expired differ only in what the boxes are worth. A wrong code keeps its
 * digits — the user has to check them against the email, and clearing the
 * field makes them retype six characters from memory. An expired one stops
 * pretending the boxes matter and offers the two ways out.
 */
export const CheckEmailScreen: React.FC<{
  email: string;
  code: string;
  onCodeChange?: (value: string) => void;
  onSubmit?: () => void;
  onBack?: () => void;
  onResend?: () => void;
  /** Seconds until a resend is allowed. 0 or absent enables the link. */
  resendIn?: number;
  /** The code did not match. Digits stay put. */
  wrong?: boolean;
  attemptsLeft?: number;
  /** The code is past its ten minutes; only a new one will do. */
  expired?: boolean;
  busy?: boolean;
  minutes?: number;
  chrome?: boolean;
}> = ({
  email,
  code,
  onCodeChange,
  onSubmit,
  onBack,
  onResend,
  resendIn = 0,
  wrong,
  attemptsLeft,
  expired,
  busy,
  minutes = 10,
  chrome,
}) => (
  <AuthFrame {...(chrome !== undefined ? { chrome } : {})}>
    <button type="button" className="wr-auth-back" onClick={onBack}>
      ← Back
    </button>

    <h1 className="wr-display-30 wr-auth-title">
      {expired ? "That code has expired" : "Check your email"}
    </h1>
    <p className="wr-auth-sub">
      {expired ? (
        <>Codes last {minutes} minutes. The next one invalidates this one.</>
      ) : (
        <>
          Six digits, sent to <b>{email}</b>. It expires in {minutes} minutes.
        </>
      )}
    </p>

    {expired ? (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
        <Button variant="primary" onClick={onResend} disabled={busy}>
          Send a new code
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Change email
        </Button>
      </div>
    ) : (
      <form
        className="wr-auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <CodeInput
          value={code}
          onChange={(next) => onCodeChange?.(next)}
          onComplete={() => onSubmit?.()}
          {...(wrong !== undefined ? { wrong } : {})}
          disabled={busy}
          autoFocus
        />

        {wrong ? (
          <p className="wr-auth-problem" role="alert">
            That code did not match. The digits stay so you can check them
            {attemptsLeft !== undefined
              ? ` — ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`
              : "."}
          </p>
        ) : null}

        <div className="wr-auth-hint">
          <span>Paste the whole code and it submits itself.</span>
          {resendIn > 0 ? (
            <span style={{ fontWeight: 600 }}>
              Resend in {countdown(resendIn)}
            </span>
          ) : (
            <Button variant="quiet" onClick={onResend} disabled={busy}>
              Resend code
            </Button>
          )}
        </div>
      </form>
    )}
  </AuthFrame>
);

/** The sidebar as every screen uses it, module slot included. */
export const AppSidebar: React.FC<{
  active: string;
  user?: ScreenUser;
  children?: React.ReactNode;
}> = ({ active, user = DEFAULT_USER, children }) => (
  <Sidebar
    items={NAV}
    active={active}
    user={
      <UserMenu
        name={user.name}
        {...(user.email !== undefined ? { email: user.email } : {})}
        {...(user.plan !== undefined ? { plan: user.plan } : {})}
      />
    }
  >
    {children}
  </Sidebar>
);

/** The sitting-streak card that lives above the sidebar's foot. */
export const SittingStreak: React.FC<{ value: string; note: string }> = ({
  value,
  note,
}) => (
  <div className="wr-module wr-elev-1" style={{ padding: "13px 14px" }}>
    <div className="wr-label">Sitting streak</div>
    <div className="wr-display-21" style={{ marginTop: 3 }}>
      {value}
    </div>
    <div className="wr-slot-meta">{note}</div>
  </div>
);

export interface TodaySlotFixture {
  variant: "focus" | "recovery" | "live" | "meeting" | "suggested";
  time: string;
  name: string;
  meta?: string;
  done?: boolean;
  source?: string;
  autoMove?: string;
  grace?: number;
}

/**
 * Today — the main window.
 *
 * The timeline is one component repeated; the rail is modules. Exactly one
 * live slot and at most one ink module, both enforced by whoever supplies the
 * fixtures rather than by the components, which cannot see their siblings.
 */
export const TodayScreen: React.FC<{
  date: string;
  helper: string;
  slots: readonly TodaySlotFixture[];
  /** Free shows a dashed gap where Pro shows a suggestion. */
  gap?: string;
  user?: ScreenUser;
  /** At most one per screen, never on the ink module. */
  planNote?: { title: string; body: string };
}> = ({ date, helper, slots, gap, user, planNote }) => (
  <AppFrame
    sidebar={
      <AppSidebar active="today" {...(user !== undefined ? { user } : {})}>
        <SittingStreak value="52 min" note="A stretch is queued next" />
      </AppSidebar>
    }
    header={
      <PageHead
        date={date}
        helper={helper}
        trailing={<LiveStatus>Adapting live · Google, Outlook</LiveStatus>}
      />
    }
    rail={
      <>
        <Module variant="attention" eyebrow="Up next · 11:00">
          <div className="wr-display-21">Back &amp; shoulder stretch</div>
          <div className="wr-slot-meta" style={{ marginTop: 5 }}>
            10 min, guided. Ends before your 11:25 focus block.
          </div>
          <Button variant="primary" block style={{ marginTop: 14 }}>
            Start now
          </Button>
          <Button variant="quiet" block>
            Not now — find a later gap
          </Button>
        </Module>

        <Module eyebrow="Missed today" count={2}>
          <div className="wr-metric">
            <div className="wr-metric-head">
              <span>Eye rest</span>
              <span className="wr-slot-meta">08:20 · no gap</span>
            </div>
            <div className="wr-metric-head">
              <span>Breathing</span>
              <span className="wr-slot-meta">skipped twice</span>
            </div>
          </div>
          <Button variant="secondary" block style={{ marginTop: 13 }}>
            Plan into tomorrow
          </Button>
        </Module>

        <Module eyebrow="Today so far">
          <Metric label="Movement" value="1 / 3" progress={0.33} />
          <Metric
            label="Focused time"
            value="50 m / 2 h"
            progress={0.42}
            tone="focus"
          />
        </Module>

        <ModuleEmpty>Add a dashboard module</ModuleEmpty>
      </>
    }
  >
    {slots.map((slot) => (
      <Slot key={`${slot.time}-${slot.name}`} {...slot} />
    ))}
    {gap ? <DashedRow>{gap}</DashedRow> : null}
    <DashedRow>+ Add a task or activity to today</DashedRow>
    {planNote ? (
      <div style={{ marginTop: 10 }}>
        <PlanNote title={planNote.title}>{planNote.body}</PlanNote>
      </div>
    ) : null}
  </AppFrame>
);

/**
 * Placing one slot by hand — the four steps Free users go through.
 *
 * Shown as one screen because the steps are the argument: a scheduler hides
 * all of this, and the point of the Free plan is that the user does it.
 */
export const PlacingScreen: React.FC<{ user?: ScreenUser }> = ({ user }) => (
  <AppFrame
    sidebar={
      <AppSidebar active="today" {...(user !== undefined ? { user } : {})} />
    }
    header={
      <PageHead
        date="Tuesday, 11 August"
        helper="Placing Shoulder stretch"
        trailing={<Chip variant="static">Step 2 of 4</Chip>}
      />
    }
  >
    <div className="wr-label">Pick it up</div>
    <DragPlacement
      time="11:30"
      range="11:30–11:40"
      name="Shoulder stretch"
      at="11:30"
    />

    <div className="wr-label" style={{ marginTop: 18 }}>
      Or set the time exactly
    </div>
    <div style={{ maxWidth: 340 }}>
      <TimeStepper value="11:05" note="5 min steps · ends 11:15" />
      <div style={{ marginTop: 14 }}>
        <FitStrip
          values={[0.2, 0.5, 0.9, 0.5, 0.2, 0.2]}
          caption="Darker means it fits your usual window for this activity."
        />
      </div>
    </div>

    <div className="wr-label" style={{ marginTop: 18 }}>
      Resolve what it lands on
    </div>
    <ClashRow
      name="Shoulder stretch · 11:05"
      reason="Inside Design review, 25 min of overlap"
      alternatives={["11:30", "12:45"]}
      dismiss="Drop"
    />
    <div style={{ marginTop: 8 }}>
      <ClashRow
        name="Deep work · 11:25"
        reason="5 min of overlap — shortening it to 20 min clears it"
        action="Shorten"
      />
    </div>
  </AppFrame>
);
