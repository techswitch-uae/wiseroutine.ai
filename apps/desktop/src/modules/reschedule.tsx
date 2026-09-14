import { Button, Stepper, stepMinutes } from "@wiseroutine/design";
import { canPostponeSlot } from "@wiseroutine/scheduler";
import { useRef, useState } from "react";
import { api, type TodaySlot } from "../lib/api";
import {
  addLocalDays,
  captureError,
  dateIn,
  pickedTime,
  refreshCaptured,
  wallTimes,
} from "../lib/capture";
import { useFeatures } from "../lib/features";
import { notify } from "../lib/notify";
import { clockIn } from "../lib/quick-add";
import {
  assertSessionScope,
  captureSessionScope,
} from "../lib/session-lifecycle";
import { CaptureModal } from "./capture-modal";
import "./capture.css";

export function Reschedule({
  slot,
  timeZone,
  onClose,
  onSaved,
}: {
  slot: Pick<TodaySlot, "id" | "title" | "startsAt" | "endsAt" | "status">;
  timeZone: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const flags = useFeatures();
  const scope = useRef(captureSessionScope()).current;
  const initial = Math.max(
    slot.startsAt,
    Math.ceil(Date.now() / 300000) * 300000,
  );
  const [date, setDate] = useState(() => dateIn(initial, timeZone));
  const [time, setTime] = useState(() => clockIn(initial, timeZone));
  const [minutes, setMinutes] = useState(() =>
    Math.max(1, Math.round((slot.endsAt - slot.startsAt) / 60000)),
  );
  const [occurrence, setOccurrence] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const intent = useRef(crypto.randomUUID());
  const save = async (at?: number) => {
    if (locked.current || !canPostponeSlot(slot)) return;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
      setError("Choose 1–480 minutes.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    const payload =
      at === undefined
        ? { bucket: true as const }
        : { startsAt: at, endsAt: at + minutes * 60000 };
    // An edited retry must not duplicate an appointment after a lost response.
    try {
      assertSessionScope(scope);
      await api.rescheduleSlot(slot.id, payload, intent.current, scope);
      assertSessionScope(scope);
      refreshCaptured();
      notify(
        at === undefined
          ? "Moved to inbox"
          : `Moved to ${new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(at)}`,
      );
      onSaved?.();
      onClose();
    } catch (cause) {
      setError(captureError(cause, "Couldn't move this slot."));
      refreshCaptured();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const submit = () => {
    try {
      void save(pickedTime(date, time, timeZone, Date.now(), occurrence));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose a valid time");
    }
  };
  if (!canPostponeSlot(slot))
    return (
      <CaptureModal title={`Postpone · ${slot.title}`} onClose={onClose}>
        <p>
          This slot can't be postponed. A started slot must be stopped first
          while its stop window is open, or you can create another slot.
        </p>
      </CaptureModal>
    );
  const intro = `${timeZone}. Choose another time${
    flags.inbox ? " or keep it in the inbox without a date" : ""
  }.`;
  return (
    <CaptureModal
      title={`Postpone · ${slot.title}`}
      subtitle={intro}
      onClose={() => {
        if (!locked.current) onClose();
      }}
      footer={
        <>
          <Button variant="primary" onClick={submit} disabled={busy}>
            Move slot
          </Button>
          {flags.inbox ? (
            <Button variant="quiet" onClick={() => void save()} disabled={busy}>
              Back to inbox
            </Button>
          ) : null}
        </>
      }
    >
      <form
        style={{ display: "grid", gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {["missed", "skipped"].includes(slot.status) ? (
          <p className="wr-body" style={{ margin: 0 }}>
            The original session stays in history. This creates a new
            appointment
            {flags.inbox
              ? " with the same todo and files"
              : " for this activity"}
            .
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="wr-auth-problem" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        {flags.inbox ? (
          <div className="wr-palette-pills" style={{ margin: 0 }}>
            <button
              type="button"
              className="wr-palette-pill"
              disabled={busy}
              onClick={() => {
                setDate(addLocalDays(dateIn(Date.now(), timeZone), 1));
                setTime(clockIn(slot.startsAt, timeZone));
                setOccurrence(0);
              }}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className="wr-palette-pill"
              disabled={busy}
              onClick={() => {
                setDate(addLocalDays(dateIn(Date.now(), timeZone), 7));
                setOccurrence(0);
              }}
            >
              Next week
            </button>
          </div>
        ) : null}
        <div className="wr-field">
          <span className="wr-label">When</span>
          {/* The same pills Working hours is set with in Settings. */}
          <div className="wr-hours-row">
            <input
              type="date"
              className="wr-timefield"
              aria-label="Day"
              required
              value={date}
              min={dateIn(Date.now(), timeZone)}
              disabled={busy}
              onChange={(e) => {
                setDate(e.target.value);
                setOccurrence(0);
              }}
            />
            <span className="wr-hours-to">at</span>
            <input
              type="time"
              className="wr-timefield"
              aria-label="Time"
              required
              value={time}
              disabled={busy}
              onChange={(e) => {
                setTime(e.target.value);
                setOccurrence(0);
              }}
            />
            {wallTimes(date, time, timeZone).length > 1 ? (
              <select
                className="wr-timefield"
                aria-label="This time occurs twice"
                value={occurrence}
                disabled={busy}
                onChange={(e) => setOccurrence(Number(e.target.value))}
              >
                <option value={0}>First occurrence</option>
                <option value={1}>Second occurrence</option>
              </select>
            ) : null}
          </div>
        </div>
        {/* The same control an activity's length is set with, one to eight
            hours rather than the activity form's two. */}
        <Stepper
          label="How long"
          value={`${minutes} min`}
          canDecrease={minutes > 1 && !busy}
          canIncrease={minutes < 480 && !busy}
          onStep={(direction) =>
            setMinutes(stepMinutes(minutes, direction, 480))
          }
        />
      </form>
    </CaptureModal>
  );
}
