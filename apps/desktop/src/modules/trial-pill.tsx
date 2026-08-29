import { Chip } from "@wiseroutine/design";
import { useAccount } from "../lib/account";
import { daysLeft, trialLabel } from "../lib/trial";

/**
 * How much of a trial or a founding grant is left.
 *
 * In the sidebar foot rather than on a billing page, because the point is that
 * it is never a surprise. The design's expiry card (4l) arrives on the last
 * three days; this is the quiet version that sits there the whole time so the
 * card is a reminder rather than news.
 *
 * Only for a grant. A Stripe subscription also has a `planExpiresAt` - the end
 * of the period it has been paid for - and counting that down would tell
 * someone who is paying every month that their access runs out on the 14th.
 */

export const TrialPill: React.FC<{ now?: number }> = ({ now = Date.now() }) => {
  const account = useAccount();
  if (account?.planSource !== "grant" || !account.planExpiresAt) {
    return null;
  }

  const days = daysLeft(account.planExpiresAt, now);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 4px 2px",
        font: "500 12px var(--font-body)",
        color: "var(--wr-text-muted)",
      }}
    >
      <span>Pro</span>
      <Chip variant="static">{trialLabel(days)}</Chip>
    </div>
  );
};
