import { Widget } from "@wiseroutine/design";
import { api } from "../lib/api";
import { usePlan } from "../lib/plan-store";

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "This is the plan as it was saved", in the rail.
 *
 * Shown only when the plan on screen came from storage rather than the
 * server. A stale plan presented as current is worse than an error - someone
 * would follow a routine that has since been replanned around a meeting they
 * cannot see. Saying when it was saved lets them judge that themselves.
 *
 * In the rail rather than above the day, beside `ReconnectRail`: both say the
 * day may be wrong, and that belongs in the column the eye goes to when the
 * day is not what was expected, not in a strip the timeline pushes down.
 */
export const SavedPlan: React.FC = () => {
  const plan = usePlan();
  if (!plan?.stale || plan.cachedAt === undefined) return null;
  // ponytail: read once per render. The count only changes when a queued
  // change is flushed, and that flush republishes a fresh plan - which
  // removes this widget anyway.
  const queued = api.pendingCount();
  return (
    <Widget variant="attention" eyebrow="Offline">
      <p
        role="status"
        style={{ margin: "8px 0 0", font: "500 12.5px/1.5 var(--font-body)" }}
      >
        Showing the plan saved at {clock.format(new Date(plan.cachedAt))}
        {queued > 0
          ? `. ${queued} ${queued === 1 ? "change" : "changes"} will sync when you reconnect.`
          : "."}
      </p>
    </Widget>
  );
};
