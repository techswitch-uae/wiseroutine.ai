import type React from "react";
import {
  Avatar,
  Block,
  Button,
  Card,
  Chip,
  ClashRow,
  CodeInput,
  DashedRow,
  DayPicker,
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
  Segmented,
  SelectField,
  Slot,
  Stepper,
  TimeField,
  TimeStepper,
  Toggle,
} from "./components";
import { AppFrame, AuthFrame, PageHead, Sidebar, UserMenu } from "./layout";

/**
 * The collection: whole screens, composed only from the kit.
 *
 * Nothing here introduces a surface, a colour or an elevation of its own - if
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
 * The emailed code is the path the screen is built around - it is the one that
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
  /** Omit or empty to hide the rule and the buttons entirely - an environment
   *  with no provider credentials must not offer a door that cannot open. */
  providers?: readonly SocialProvider[];
  onProvider?: (provider: SocialProvider) => void;
  /** Sending the emailed code. Only the code path - a provider sign-in must
   *  not make this button claim it is sending anything. */
  busy?: boolean;
  /** Consent is open in a browser and we are waiting for it to come back. */
  waitingFor?: SocialProvider | null;
  onCancelWaiting?: () => void;
  /** Set when the browser could not be opened for us - a popup blocker, or a
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
          Signing in with Google or Microsoft does not connect that calendar -
          you choose calendars separately, after you are in.
        </p>
      </>
    ) : null}
  </AuthFrame>
);

/* ── Account ─────────────────────────────────────────────────────────────── */

export interface LinkedAccount {
  /** Better Auth's account row id - what an unlink is addressed to. */
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
 * different grants, and this page is only about the first - the note says so,
 * because "Disconnect Google" here could otherwise read as "stop syncing my
 * Google calendar", which it is not.
 *
 * One card holding hairline blocks, the way Calendars draws a connection and
 * its calendars. Four raised cards said these were four objects of equal
 * weight to the page rather than four parts of one.
 */
export const AccountScreen: React.FC<{
  email: string;
  name: string;
  /** Rendered only when it is an `https:` URL - see `Avatar`. */
  avatarUrl?: string | null;
  /** Draft name in the field, which is not the saved one until it is saved. */
  draftName?: string;
  onDraftNameChange?: (value: string) => void;
  onSaveName?: () => void;
  onCancelName?: () => void;
  /** True while a save is in flight. */
  savingName?: boolean;
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
  onCancelName,
  savingName,
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
  // A typed value is the one thing here that needs an explicit commit, so the
  // pair appears exactly when there is something to commit and the button
  // disappearing is the confirmation. A permanently disabled "Save" was
  // reporting the same state with more furniture.
  const nameChanged = draft.trim() !== name.trim();

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

      <Card>
        <Block
          title="Name"
          note="Providers give us a name when you sign in with them. This overrides it."
          {...(nameChanged
            ? {
                footer: (
                  <>
                    <Button
                      variant="primary"
                      onClick={onSaveName}
                      disabled={savingName}
                    >
                      {savingName ? "Updating…" : "Update"}
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={onCancelName}
                      disabled={savingName}
                    >
                      Cancel
                    </Button>
                  </>
                ),
              }
            : {})}
        >
          <Field
            aria-label="Name"
            value={draft}
            onChange={(event) => onDraftNameChange?.(event.target.value)}
            placeholder="How should we address you?"
            autoComplete="name"
          />
        </Block>

        {timeZone ? (
          <Block
            title="Time zone"
            note="Everything is scheduled in this zone - your day's start and end, and when each activity is due."
          >
            <SelectField
              aria-label="Time zone"
              options={
                // Always include the saved value, even if this build of the
                // browser does not list it - otherwise the select silently
                // shows the wrong zone as selected.
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
          </Block>
        ) : null}

        <Block
          title="How you sign in"
          note="Disconnecting only removes this way of signing in - your calendars stay connected, and the emailed code still works."
        >
          {accounts.length === 0 ? (
            <p className="wr-account-empty">
              A code emailed to <b>{email}</b>. That always works, whether or
              not a provider is connected.
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
                  {disconnecting === account.id
                    ? "Disconnecting…"
                    : "Disconnect"}
                </Button>
              </div>
            ))
          )}

          {problem ? (
            <p className="wr-auth-problem" role="alert">
              {problem}
            </p>
          ) : null}
        </Block>

        <Block title="This device">
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
        </Block>
      </Card>
    </div>
  );
};

/* ── Day view hours ──────────────────────────────────────────────────────── */

/** The one custom range, as the settings screen holds it while it is edited. */
export interface CustomRange {
  label: string;
  startMinutes: number;
  endMinutes: number;
}

export interface DayHoursDraft {
  /** The working window - the same one the planner places into. */
  dayStartMinutes: number;
  dayEndMinutes: number;
  /** Null when the user has not named a range. */
  custom: CustomRange | null;
  dayOpensOn: "working" | "full" | "custom";
  showOutsideRange: boolean;
}

/** Which block's typed values are being saved. */
export type DayHoursBlock = "working" | "custom";

/** What switching the custom range on starts from. An empty label and
 *  00:00–00:00 would be a range the server refuses, so the switch would fail
 *  the moment it was flipped. */
const NEW_CUSTOM_RANGE: CustomRange = {
  label: "Evenings",
  startMinutes: 17 * 60,
  endMinutes: 22 * 60,
};

const OPENS_ON = [
  { value: "working", label: "Working" },
  { value: "full", label: "Full day" },
  { value: "custom", label: "Custom" },
] as const;

/**
 * Where the day view's ranges are configured.
 *
 * Working hours are first because they are not only a view: they are the
 * window slots are placed in, so changing them changes the plan and not just
 * what is drawn. The note says so - it is the one thing on this screen with a
 * consequence beyond the timeline.
 *
 * Two ways to commit, decided by the control rather than by the screen. A
 * toggle or a segmented choice *is* the decision, so it saves on click and the
 * screen shows the new state at once; a typed value is not a decision until
 * the typing stops, so hours and a name commit through Update inside their own
 * block. A single Update at the foot of the section could not say which values
 * it was about, and made switching a toggle a two-step act for no reason.
 */
export const DayHoursSection: React.FC<{
  /** What the server holds. */
  saved: DayHoursDraft;
  /** The same, plus whatever has been typed since. */
  draft: DayHoursDraft;
  onChange?: (patch: Partial<DayHoursDraft>) => void;
  /** Saved the moment it changes - every control that is not typed into. */
  onCommit?: (patch: Partial<DayHoursDraft>) => void;
  /** Save one block's typed values. */
  onSave?: (block: DayHoursBlock) => void;
  /** Throw them away and go back to `saved`. */
  onCancel?: (block: DayHoursBlock) => void;
  saving?: DayHoursBlock | null;
}> = ({ saved, draft, onChange, onCommit, onSave, onCancel, saving }) => {
  const custom = draft.custom;

  /** Update and Cancel, or nothing at all when there is nothing to commit. */
  const commit = (block: DayHoursBlock, changed: boolean) =>
    changed
      ? {
          footer: (
            <>
              <Button
                variant="primary"
                onClick={() => onSave?.(block)}
                disabled={saving !== null && saving !== undefined}
              >
                {saving === block ? "Updating…" : "Update"}
              </Button>
              <Button
                variant="quiet"
                onClick={() => onCancel?.(block)}
                disabled={saving !== null && saving !== undefined}
              >
                Cancel
              </Button>
            </>
          ),
        }
      : {};

  return (
    <div className="wr-account">
      <Card>
        <Block
          title="Working hours"
          note="Also the hours slots are placed in"
          {...commit(
            "working",
            draft.dayStartMinutes !== saved.dayStartMinutes ||
              draft.dayEndMinutes !== saved.dayEndMinutes,
          )}
        >
          <div className="wr-hours-row">
            <TimeField
              label="Working hours start"
              minutes={draft.dayStartMinutes}
              onChange={(dayStartMinutes) => onChange?.({ dayStartMinutes })}
            />
            <span className="wr-hours-to">to</span>
            <TimeField
              label="Working hours end"
              minutes={draft.dayEndMinutes}
              onChange={(dayEndMinutes) => onChange?.({ dayEndMinutes })}
            />
          </div>
        </Block>

        <Block
          title="Custom range"
          note={
            custom
              ? "The label is what appears in the day view picker."
              : "A second window to switch the day to - your evenings, or the hours you are on call."
          }
          action={
            <Toggle
              label="Use a custom range"
              checked={custom !== null}
              // Saved on click, with a range already in it: a switch that
              // turned on and then needed a second press to exist is how the
              // range ended up missing from the day view's picker.
              onChange={(on) =>
                onCommit?.({ custom: on ? { ...NEW_CUSTOM_RANGE } : null })
              }
            />
          }
          {...(custom
            ? commit(
                "custom",
                JSON.stringify(custom) !== JSON.stringify(saved.custom),
              )
            : {})}
        >
          {custom ? (
            <div className="wr-hours-row">
              <Field
                aria-label="Custom range name"
                className="wr-hours-name-field"
                value={custom.label}
                placeholder="Name this range"
                onChange={(event) =>
                  onChange?.({
                    custom: { ...custom, label: event.target.value },
                  })
                }
              />
              <TimeField
                label="Custom range start"
                minutes={custom.startMinutes}
                onChange={(startMinutes) =>
                  onChange?.({ custom: { ...custom, startMinutes } })
                }
              />
              <span className="wr-hours-to">to</span>
              <TimeField
                label="Custom range end"
                minutes={custom.endMinutes}
                onChange={(endMinutes) =>
                  onChange?.({ custom: { ...custom, endMinutes } })
                }
              />
            </div>
          ) : null}
        </Block>

        <Block
          title="Day opens on"
          note="The range the timeline shows each morning"
          action={
            <Segmented
              label="Day opens on"
              options={OPENS_ON}
              value={draft.dayOpensOn}
              onChange={(dayOpensOn) => onCommit?.({ dayOpensOn })}
            />
          }
        />

        <Block
          title="Show meetings outside the range"
          note="Collapsed into a line at the top and bottom of the day"
          action={
            <Toggle
              label="Show meetings outside the range"
              checked={draft.showOutsideRange}
              onChange={(showOutsideRange) => onCommit?.({ showOutsideRange })}
            />
          }
        />
      </Card>
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
 * digits - the user has to check them against the email, and clearing the
 * field makes them retype six characters from memory. An expired one stops
 * pretending the boxes matter and offers the two ways out.
 */
export const CheckEmailScreen: React.FC<{
  email: string;
  code: string;
  onCodeChange?: (value: string) => void;
  /** The pasted code arrives as an argument: on paste the parent's `code`
   *  state is still a render behind, so submitting from it sends nothing. */
  onSubmit?: (code?: string) => void;
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
          onComplete={(next) => onSubmit?.(next)}
          {...(wrong !== undefined ? { wrong } : {})}
          disabled={busy}
          autoFocus
        />

        {wrong ? (
          <p className="wr-auth-problem" role="alert">
            That code did not match. The digits stay so you can check them
            {attemptsLeft !== undefined
              ? ` - ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`
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
    // The kit documents quick add even though the app has not bound it yet -
    // the catalogue is the plan, the app's own rail is the product.
    onQuickAdd={() => undefined}
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
 * Today - the main window.
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
            Not now - find a later gap
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
 * Placing one slot by hand - the four steps Free users go through.
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
        reason="5 min of overlap - shortening it to 20 min clears it"
        action="Shorten"
      />
    </div>
  </AppFrame>
);

/* ── Activities ──────────────────────────────────────────────────────────── */

/**
 * Where in the day an activity should land.
 *
 * A preference, not a rule, and the words are chosen to say so. The planner
 * resolves these into preferred instants and then places each session in the
 * nearest gap that will take it - so "Mornings" pulls, it does not fence.
 * Calling it a permission ("may only be placed in the morning") would describe
 * a constraint the scheduler does not have.
 */
export type ActivityLanding = "any" | "morning" | "afternoon";

/** Private: the form is the only thing that offers these, and exporting a
 *  constant beside components is what breaks fast refresh for the whole file. */
const LANDINGS: readonly { value: ActivityLanding; label: string }[] = [
  { value: "any", label: "Any working hour" },
  { value: "morning", label: "Mornings" },
  { value: "afternoon", label: "Afternoons" },
];

/**
 * An activity as the form holds it, before it is an activity.
 *
 * Deliberately not the API's shape: `perDay` and `sessionMinutes` are the two
 * numbers a person actually decides ("ten minutes, three times a day"), and
 * the caller turns them into the minimum the schema stores.
 */
export interface ActivityDraft {
  name: string;
  kind: "recovery" | "focus" | "task";
  /** How long one session runs. */
  sessionMinutes: number;
  /** How many of them, on each day it runs. */
  perDay: number;
  /** Which days it runs on, as the stored seven-bit mask. `EVERY_DAY` is the
   *  default and the one most activities keep. */
  days: number;
  land: ActivityLanding;
}

/** One thing to start from. `key` is the identity - two entries may share a
 *  name once the user has renamed one. */
export interface ActivityTemplate extends ActivityDraft {
  key: string;
}

/**
 * The library, and the way out of it.
 *
 * Chips rather than a list of cards: these are starting points, not things
 * that exist yet, and the dashed edge is the kit's word for "not a real object
 * on the page". The last one carries no duration because it has none - it is
 * the door to describing your own.
 */
export const ActivityLibrary: React.FC<{
  templates: readonly ActivityTemplate[];
  /** Shown against the title, e.g. "0 of 2 used". Omit on an unlimited plan. */
  used?: string;
  /** Null is "something else" - the caller starts an empty draft. */
  onPick: (template: ActivityTemplate | null) => void;
  /** Greys the whole library out at the plan's limit, so the choice is made
   *  in one place rather than refused after the fact. */
  disabled?: boolean;
}> = ({ templates, used, onPick, disabled }) => (
  <Card
    title="Add an activity"
    note="Start from one of these and adjust it, or describe your own. Everything is editable afterwards."
    {...(used
      ? { action: <span className="wr-setup-count">{used}</span> }
      : {})}
  >
    <div className="wr-library">
      {templates.map((template) => (
        <button
          key={template.key}
          type="button"
          className="wr-chip wr-chip-dashed wr-library-chip"
          disabled={disabled}
          onClick={() => onPick(template)}
        >
          <b>{template.name}</b> {template.sessionMinutes} min
        </button>
      ))}
      <button
        type="button"
        className="wr-chip wr-chip-dashed wr-library-chip"
        disabled={disabled}
        onClick={() => onPick(null)}
      >
        <b>Something else</b>
      </button>
    </div>
  </Card>
);

/**
 * The activity itself, in full - fields only.
 *
 * No frame of its own, because it is always inside one: the app puts it in a
 * sheet, the gallery in a card. A component that draws its own card and is
 * then dropped into a dialog is two frames deep, and the caller has no way to
 * take one off.
 *
 * Every field is one the scheduler reads. There is no "remind me" switch here
 * even though the design carries one: nothing in the app sends a notification
 * yet, and a switch that records a preference nobody acts on is a promise the
 * product cannot keep. It goes in when the notification does.
 */
export const ActivityForm: React.FC<{
  draft: ActivityDraft;
  onChange: (next: ActivityDraft) => void;
  /**
   * True when the draft came from the library and is already named. The name
   * field appears only when it did not - a library pick has a name, and
   * anything else has to be given one by the person describing it.
   */
  named?: boolean;
  /**
   * Appended below the standing fields.
   *
   * Where the app puts the module section - which module runs this activity,
   * how it starts, and whatever settings that module asks for. It lives in the
   * app rather than here because the module registry does: this package draws
   * forms, and has no business knowing that breathing has patterns.
   */
  children?: React.ReactNode;
}> = ({ draft, onChange, named, children }) => {
  const set = <K extends keyof ActivityDraft>(
    key: K,
    value: ActivityDraft[K],
  ) => onChange({ ...draft, [key]: value });

  // One stack with one gap, rather than each field remembering to space itself
  // off the one above it. That is how the day picker ended up flush against
  // the landing segments underneath it.
  return (
    <div className="wr-activity-form">
      {named ? null : (
        <Field
          label="Name"
          value={draft.name}
          placeholder="Walk round the block"
          onChange={(event) => set("name", event.target.value)}
        />
      )}

      <div className="wr-activity-pair">
        <Stepper
          label="How long"
          value={`${draft.sessionMinutes} min`}
          // Five-minute steps above five, because that is the ruler the day is
          // drawn on and a 7-minute block cannot be placed on it.
          canDecrease={draft.sessionMinutes > 1}
          canIncrease={draft.sessionMinutes < 120}
          onStep={(direction) =>
            set("sessionMinutes", stepMinutes(draft.sessionMinutes, direction))
          }
        />
        <Stepper
          label="How often"
          value={`${draft.perDay} × day`}
          canDecrease={draft.perDay > 1}
          canIncrease={draft.perDay < 12}
          onStep={(direction) => set("perDay", draft.perDay + direction)}
        />
      </div>

      <DayPicker
        label="Which days"
        value={draft.days}
        onChange={(days) => set("days", days)}
      />

      <div className="wr-field">
        <span className="wr-label">When it should land</span>
        <Segmented
          label="When it should land"
          options={LANDINGS}
          value={draft.land}
          onChange={(value) => set("land", value)}
        />
        <p className="wr-activity-hint">
          A preference, not a rule - it lands as close to that as the day
          allows.
        </p>
      </div>

      {children}
    </div>
  );
};

/** One minute at a time under five, then five - so "1 min" is reachable and
 *  an hour is not forty presses away. */
const stepMinutes = (value: number, direction: -1 | 1): number => {
  const step = value < 5 || (direction === -1 && value <= 5) ? 1 : 5;
  return Math.min(120, Math.max(1, value + step * direction));
};

/**
 * An activity that exists, in the list of them.
 *
 * Pause rather than delete is the first way out, because the free limit counts
 * active ones - pausing is the swap the plan note talks about, and it keeps
 * the history the missed list reads.
 */
export const ActivityRow: React.FC<{
  name: string;
  /** "10 min · 3 × day · mornings", composed by the caller. */
  meta: string;
  isActive: boolean;
  onEdit?: () => void;
  onToggle?: () => void;
  onRemove?: () => void;
  busy?: boolean;
}> = ({ name, meta, isActive, onEdit, onToggle, onRemove, busy }) => (
  <div className="wr-activity-row">
    <span className={isActive ? "wr-rule" : "wr-rule wr-rule-neutral"} />
    <div className="wr-activity-body">
      <div className="wr-slot-name">{name}</div>
      <div className="wr-slot-meta">{meta}</div>
    </div>
    {isActive ? null : <Chip variant="static">Paused</Chip>}
    {onEdit ? (
      <Button variant="quiet" onClick={onEdit}>
        Edit
      </Button>
    ) : null}
    {onToggle ? (
      <Button variant="secondary" disabled={busy} onClick={onToggle}>
        {isActive ? "Pause" : "Resume"}
      </Button>
    ) : null}
    {onRemove ? (
      <Button variant="quiet" disabled={busy} onClick={onRemove}>
        Remove
      </Button>
    ) : null}
  </div>
);
