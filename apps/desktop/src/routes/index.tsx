import { createFileRoute } from "@tanstack/react-router";
import { Button, DashedRow, LiveStatus, Slot } from "@wiseroutine/design";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  buildTimeline,
  getSessionToken,
  type TodayResponse,
} from "../lib/api";

const timeFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

const Today: React.FC = () => {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    if (!getSessionToken()) {
      setError("not_connected");
      return;
    }
    api
      .today()
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError && cause.status === 401
            ? "not_connected"
            : "offline",
        );
      });
  }, []);

  useEffect(load, [load]);

  // The live slot is decided by the clock, so the timeline has to re-render as
  // it passes. A minute is enough — nothing here changes faster than that.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (error === "not_connected") return <SignIn onDone={load} />;

  if (!data) {
    return (
      <main className="wr-shell">
        <p className="wr-body">
          {error === "offline"
            ? "Can't reach Wise Routine right now."
            : "Loading your day…"}
        </p>
      </main>
    );
  }

  const format = timeFormatter(data.timeZone);
  const rows = buildTimeline(data, now);
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: data.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(data.dayStart));

  return (
    <main className="wr-shell">
      <header className="wr-shell-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>
            {dayLabel}
          </span>
          <span
            style={{
              font: "600 12px var(--font-body)",
              color: "var(--wr-text-muted)",
            }}
          >
            {rows.filter((r) => r.variant === "recovery").length} recovery slots
            found
          </span>
        </div>
        <LiveStatus>Adapting live</LiveStatus>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.length === 0 ? (
          <DashedRow gutter={false}>
            Nothing planned yet — plan your day
          </DashedRow>
        ) : (
          rows.map((row) => (
            <Slot
              key={row.key}
              variant={row.variant}
              time={format.format(new Date(row.startsAt))}
              name={row.title}
              meta={row.meta ?? ""}
              done={row.done ?? false}
              grace={0.7}
              autoMove="Moves itself if you don't start"
              onStart={() => {
                if (row.slotId) void api.startSlot(row.slotId).then(load);
              }}
            />
          ))
        )}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <Button variant="secondary" onClick={() => void api.plan().then(load)}>
          Re-plan today
        </Button>
        <ConnectCalendar />
      </div>
    </main>
  );
};

/** The design system has no text field yet — one screen does not justify
 *  adding one, so this borrows its tokens. */
const fieldStyle: React.CSSProperties = {
  font: "400 15px var(--font-body)",
  padding: "11px 14px",
  borderRadius: 12,
  border: "1px solid var(--wr-hairline)",
  background: "var(--wr-recessed)",
  boxShadow: "var(--wr-inset)",
  color: "var(--wr-ink)",
};

/**
 * Signing in.
 *
 * A code to the address, nothing else — no password to forget, and no
 * dependency on Google having approved us yet. The same form registers: an
 * address that can read its own mail is the whole account.
 */
const SignIn: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = (work: Promise<unknown>, then: () => void) => {
    setBusy(true);
    setProblem(null);
    work
      .then(() => then())
      .catch((cause: unknown) =>
        setProblem(
          cause instanceof ApiError && cause.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : sent
              ? "That code didn't work. Check it, or ask for a new one."
              : "Couldn't send the code. Try again.",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main className="wr-shell" style={{ maxWidth: 460 }}>
      <h1 className="wr-display-30" style={{ marginBottom: 8 }}>
        {sent ? "Check your email" : "Sign in"}
      </h1>
      <p className="wr-body" style={{ marginBottom: 20 }}>
        {sent
          ? `We sent a six-digit code to ${email}. It expires in five minutes.`
          : "We'll email you a code. No password to set or remember."}
      </p>

      <form
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (sent) run(api.signIn(email, code), onDone);
          else run(api.sendCode(email), () => setSent(true));
        }}
      >
        {sent ? (
          <input
            style={fieldStyle}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            aria-label="Sign-in code"
            required
          />
        ) : (
          <input
            style={fieldStyle}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email address"
            required
          />
        )}

        {problem ? (
          <p
            className="wr-body"
            style={{ color: "var(--wr-ink)" }}
            role="alert"
          >
            {problem}
          </p>
        ) : null}

        <Button variant="commit" block type="submit" disabled={busy}>
          {sent ? "Sign in" : "Email me a code"}
        </Button>

        {sent ? (
          <Button
            variant="quiet"
            block
            type="button"
            onClick={() => {
              setSent(false);
              setCode("");
            }}
          >
            Use a different address
          </Button>
        ) : null}
      </form>
    </main>
  );
};

/** Connecting a calendar is a separate, later act — consent completes in the
 *  system browser and returns through the app's deep link. */
const ConnectCalendar: React.FC = () => (
  <>
    <Button
      variant="quiet"
      onClick={() => void api.connectUrl("google").then((url) => open(url))}
    >
      Connect Google
    </Button>
    <Button
      variant="quiet"
      onClick={() => void api.connectUrl("microsoft").then((url) => open(url))}
    >
      Connect Outlook
    </Button>
  </>
);

export const Route = createFileRoute("/")({ component: Today });
