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
    if (locked.current) return;
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
  return (
    <CaptureModal
      title={`Postpone · ${slot.title}`}
      onClose={() => {
        if (!locked.current) onClose();
      }}
    >
      <form
        className="wr-capture-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p>
          {timeZone}. Choose another time
          {flags.inbox ? " or keep it in the inbox without a date" : ""}.
        </p>
        {["started", "missed", "skipped"].includes(slot.status) ? (
          <p>
            The original session stays in history. This creates a new
            appointment
            {flags.inbox
              ? " with the same todo and files"
              : " for this activity"}
            .
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="wr-capture-error">
            {error}
          </p>
        ) : null}
        <div className="wr-capture-actions">
          <button
            type="button"
            className="wr-palette-pill"
            disabled={busy}
            onClick={() =>
              void save(
                Math.ceil(
                  (Math.max(Date.now(), slot.startsAt) + 30 * 60000) / 300000,
                ) * 300000,
              )
            }
          >
            30 minutes later
          </button>
          {flags.inbox ? (
            <>
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
            </>
          ) : null}
        </div>
        <label className="wr-capture-label">
          Day
          <input
            type="date"
            required
            value={date}
            min={dateIn(Date.now(), timeZone)}
            disabled={busy}
            onChange={(e) => {
              setDate(e.target.value);
              setOccurrence(0);
            }}
          />
        </label>
        <label className="wr-capture-label">
          Time
          <input
            type="time"
            required
            value={time}
            disabled={busy}
            onChange={(e) => {
              setTime(e.target.value);
              setOccurrence(0);
            }}
          />
        </label>
        {wallTimes(date, time, timeZone).length > 1 ? (
          <label className="wr-capture-label">
            This time occurs twice
            <select
              value={occurrence}
              disabled={busy}
              onChange={(e) => setOccurrence(Number(e.target.value))}
            >
              <option value={0}>First occurrence</option>
              <option value={1}>Second occurrence</option>
            </select>
          </label>
        ) : null}
        <label className="wr-capture-label">
          Minutes
          <input
            type="number"
            required
            min={1}
            max={480}
            value={minutes}
            disabled={busy}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        <div className="wr-capture-actions">
          <button
            type="submit"
            className="wr-palette-pill wr-palette-pill-on"
            disabled={busy}
          >
            Move slot
          </button>
          {flags.inbox ? (
            <button
              type="button"
              className="wr-palette-pill"
              disabled={busy}
              onClick={() => void save()}
            >
              Back to inbox
            </button>
          ) : null}
        </div>
      </form>
    </CaptureModal>
  );
}
