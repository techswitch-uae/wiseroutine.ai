import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@wiseroutine/design";
import { useEffect, useState } from "react";

/**
 * Where the calendar consent round-trip lands.
 *
 * Signing in happens in the app itself now (an emailed code); this only ever
 * reports whether a calendar got connected. No token passes through here —
 * provider tokens stay on the server, encrypted, in the user's own database.
 */
const AuthComplete: React.FC = () => {
  const navigate = useNavigate();
  const { error, consentUrl } = Route.useSearch();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (error) return;
    void navigate({ to: "/", replace: true });
  }, [error, navigate]);

  /**
   * Many work tenants disable user consent, so an employee cannot grant even a
   * read-only calendar permission. That is not their mistake and not a bug —
   * an administrator has to approve the app once, for everyone. Giving them a
   * link to forward turns a dead end into a slow yes.
   */
  if (error === "admin_consent_required") {
    return (
      <main className="wr-shell" style={{ maxWidth: 520 }}>
        <h1 className="wr-display-30" style={{ marginBottom: 8 }}>
          Your IT admin needs to approve this
        </h1>
        <p className="wr-body" style={{ marginBottom: 16 }}>
          Your organisation doesn't let people connect apps on their own. An
          administrator can approve Wise Routine once and everyone in your
          company can connect after that. Send them this link.
        </p>

        {consentUrl ? (
          <div
            className="wr-elev-inset"
            style={{
              background: "var(--wr-recessed)",
              borderRadius: 14,
              padding: "12px 14px",
              marginBottom: 16,
              font: "400 11.5px ui-monospace, Menlo, monospace",
              wordBreak: "break-all",
              color: "var(--wr-text-muted)",
            }}
          >
            {consentUrl}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10 }}>
          <Button
            variant="commit"
            onClick={() => {
              if (!consentUrl) return;
              void navigator.clipboard
                ?.writeText(consentUrl)
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy link for your admin"}
          </Button>
          <Button
            variant="quiet"
            onClick={() => void navigate({ to: "/", replace: true })}
          >
            Use a different account
          </Button>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="wr-shell" style={{ maxWidth: 460 }}>
        <h1 className="wr-display-30" style={{ marginBottom: 8 }}>
          That calendar wasn't connected
        </h1>
        <p className="wr-body" style={{ marginBottom: 16 }}>
          Nothing was connected. You can try again whenever you like.
        </p>
        <Button
          variant="commit"
          onClick={() => void navigate({ to: "/", replace: true })}
        >
          Back
        </Button>
      </main>
    );
  }

  return (
    <main className="wr-shell">
      <p className="wr-body">Finishing up…</p>
    </main>
  );
};

export const Route = createFileRoute("/auth/complete")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { error?: string; consentUrl?: string } => ({
    error: typeof search.error === "string" ? search.error : undefined,
    consentUrl:
      typeof search.consentUrl === "string" ? search.consentUrl : undefined,
  }),
  component: AuthComplete,
});
