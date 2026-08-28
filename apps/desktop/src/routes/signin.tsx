import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  CheckEmailScreen,
  SignInScreen,
  type SocialProvider,
} from "@wiseroutine/design";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  getSessionToken,
  OfflineError,
  SocialSignInError,
} from "../lib/api";
import { openExternal } from "../lib/open-external";

/**
 * Signing in, deliberately outside the app shell.
 *
 * Its own route rather than a branch inside Today: someone with no session has
 * no navigation to show and no user to name, so rendering the sidebar around
 * this screen would be furniture for an account that does not exist yet. It
 * also means the redirect below is the only place that decides who gets in.
 *
 * Every composition here comes from `@wiseroutine/design` - this file is the
 * wiring and nothing else. When a state needs a surface the kit does not have,
 * the fix belongs in the kit.
 */

/** Matches `OTP_MINUTES` in the API. Both the copy and the resend window are
 *  derived from it, so the screen cannot drift from what the server enforces. */
const OTP_MINUTES = 10;

/** How long before a resend is offered. Long enough that a slow inbox is not
 *  answered by sending a second code that invalidates the first. */
const RESEND_SECONDS = 30;

/**
 * What a refused provider sign-in means, in words the user can use.
 *
 * `account_not_linked` is the one worth spelling out. It happens when the
 * address already has an account but the provider's claim to it is not one we
 * trust on its own - Microsoft's email claim is tenant-mutable and never
 * verified, so we will not join two identities on the strength of it. The way
 * through is the emailed code, which proves the same thing properly.
 */
function socialProblem(reason: string, provider: SocialProvider): string {
  const name = provider === "google" ? "Google" : "Microsoft";
  if (reason === "account_not_linked") {
    return `That address already has a Wise Routine account. Sign in with the emailed code, then link ${name} from Settings.`;
  }
  if (reason === "expired") {
    return "That took too long. Try again.";
  }
  return `${name} didn't complete the sign-in. Nothing changed - you can try again.`;
}

const SignIn: React.FC = () => {
  const navigate = useNavigate();
  const goToApp = () => void navigate({ to: "/", replace: true });

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * The provider whose consent we are waiting on, if any.
   *
   * Separate from `busy` on purpose. They were one flag, and the result was a
   * screen that disabled everything and told the user it was "Sending…" an
   * email it had never touched - for as long as the poll ran, with no way out.
   */
  const [waitingFor, setWaitingFor] = useState<SocialProvider | null>(null);
  /** Only set when we could not open a browser, so the user can do it. */
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [expired, setExpired] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  /**
   * Cancels a provider sign-in that is still waiting on the browser.
   *
   * Without this, leaving the screen leaves a poll running that would drop a
   * session in minutes later, out of nowhere - the user having long since
   * given up and gone somewhere else in the app.
   */
  const social = useRef<AbortController | null>(null);
  const cancelWaiting = useCallback(() => {
    social.current?.abort();
    social.current = null;
    setWaitingFor(null);
    setConsentUrl(null);
  }, []);
  useEffect(() => () => social.current?.abort(), []);

  /** One ticking second, only while there is something to tick. */
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  /**
   * Turn a failure into something the user can act on.
   *
   * A 500 is a server misconfiguration, not something retrying fixes - saying
   * "try again" sends them round a loop. Each case gets its own answer, and
   * the code screen gets its own states rather than a sentence.
   */
  const explain = (cause: unknown): string => {
    if (cause instanceof OfflineError) {
      return "No connection. Check your network and try again.";
    }
    if (cause instanceof ApiError && cause.status === 429) {
      return "Too many attempts. Wait a minute and try again.";
    }
    if (cause instanceof ApiError && cause.status >= 500) {
      return "Something is wrong on our side - this isn't you. The server log says why.";
    }
    return sent
      ? "That code didn't work. Check it, or ask for a new one."
      : "Couldn't send the code. Try again.";
  };

  const run = (work: Promise<unknown>, then: () => void) => {
    setBusy(true);
    setProblem(null);
    work
      .then(then)
      .catch((cause: unknown) => setProblem(explain(cause)))
      .finally(() => setBusy(false));
  };

  const sendCode = () => {
    // The user has chosen the other door; a provider attempt still polling
    // would sign them in behind whatever they do next.
    cancelWaiting();
    return run(api.sendCode(email), () => {
      setSent(true);
      setCode("");
      setWrong(false);
      setExpired(false);
      setResendIn(RESEND_SECONDS);
    });
  };

  /**
   * Submit the code.
   *
   * Handled outside `run` because the two ways it fails are different screens,
   * not different sentences: a wrong code keeps its digits and counts down the
   * attempts, an expired one stops offering the boxes at all.
   */
  const submitCode = (pasted?: string) => {
    // On paste the digits arrive as an argument because `code` is still a
    // render behind - reading state here submits the previous value.
    const value = pasted ?? code;
    if (value.length < 6 || busy) return;
    setBusy(true);
    setProblem(null);
    api
      .signIn(email, value)
      .then(goToApp)
      .catch((cause: unknown) => {
        // Better Auth burns the code once it is expired or out of attempts;
        // either way the only way forward is a new one.
        const gone =
          cause instanceof ApiError &&
          (cause.status === 403 || cause.status === 404);
        if (gone) setExpired(true);
        else if (cause instanceof ApiError && cause.status === 400) {
          setWrong(true);
        } else setProblem(explain(cause));
      })
      .finally(() => setBusy(false));
  };

  /**
   * Google or Microsoft.
   *
   * Consent happens in a real browser - a provider will not render its consent
   * screen in an embedded webview, and in the packaged app navigating there
   * would replace the app itself. So: ask the server for a URL and a ticket,
   * open a browser, and only then start waiting.
   *
   * The order matters, and so does the return value of the open. Opening can
   * fail - a popup blocker, a webview with no opener - and polling for a
   * consent that was never shown is a spinner that runs until the ticket
   * expires. When it fails the user gets the link and can go by hand, which is
   * a delay rather than a dead end.
   */
  const signInWith = async (provider: SocialProvider) => {
    cancelWaiting();
    const controller = new AbortController();
    social.current = controller;

    setProblem(null);
    setConsentUrl(null);
    setWaitingFor(provider);

    try {
      const { url, ticket } = await api.startSocial(provider);
      if (controller.signal.aborted) return;

      // Surfaced only if the open fails; holding it costs nothing and saves
      // the attempt.
      if (!(await openExternal(url))) setConsentUrl(url);
      if (controller.signal.aborted) return;

      await api.awaitSocial(ticket, controller.signal);
      if (controller.signal.aborted) return;
      if (getSessionToken()) goToApp();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setProblem(
        cause instanceof SocialSignInError
          ? socialProblem(cause.reason, provider)
          : explain(cause),
      );
    } finally {
      if (!controller.signal.aborted) {
        setWaitingFor(null);
        setConsentUrl(null);
      }
    }
  };

  if (sent) {
    return (
      <main className="wr-auth-page">
        <CheckEmailScreen
          email={email}
          code={code}
          minutes={OTP_MINUTES}
          onCodeChange={(next) => {
            setCode(next);
            // The moment they start correcting it, stop telling them it was
            // wrong - the message is about the code they had, not this one.
            if (wrong) setWrong(false);
          }}
          onSubmit={submitCode}
          onResend={sendCode}
          onBack={() => {
            setSent(false);
            setCode("");
            setWrong(false);
            setExpired(false);
          }}
          resendIn={resendIn}
          wrong={wrong}
          expired={expired}
          busy={busy}
          chrome={false}
        />
      </main>
    );
  }

  return (
    <main className="wr-auth-page">
      <SignInScreen
        email={email}
        onEmailChange={setEmail}
        onSubmit={sendCode}
        onProvider={(provider) => void signInWith(provider)}
        busy={busy}
        waitingFor={waitingFor}
        onCancelWaiting={cancelWaiting}
        consentUrl={consentUrl}
        problem={problem}
        chrome={false}
      />
    </main>
  );
};

export const Route = createFileRoute("/signin")({
  // Already signed in? Nothing here to do.
  beforeLoad: () => {
    if (getSessionToken()) throw redirect({ to: "/" });
  },
  component: SignIn,
});
