import { Keycap } from "@wiseroutine/design";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dispatchQuickAdd, isServing } from "../addons/host";
import { useInstalledAddons } from "../addons/installed";
import { useAccount } from "../lib/account";
import {
  type ActivityResponse,
  api,
  type ScopeDay,
  type TodayResponse,
} from "../lib/api";
import {
  addLocalDays,
  dateIn,
  linksIn,
  captureError as message,
  pickedTime,
  refreshCaptured,
  wallTimes,
} from "../lib/capture";
import {
  type CaptureDraft,
  readCaptureDraft,
  type CaptureSubject as Subject,
  saveCaptureDraft,
} from "../lib/capture-draft";
import { useDialogFocus } from "../lib/dialog";
import { useFeatures } from "../lib/features";
import { notify } from "../lib/notify";
import { useTodayPlan } from "../lib/plan-store";
import { durationsFor, suggestionsFor } from "../lib/quick-add";
import {
  assertSessionScope,
  captureSessionScope,
  sessionIdentity,
} from "../lib/session-lifecycle";
import {
  DEFAULT_TODO_MINUTES,
  fitsAt,
  reloadTodos,
  useTodos,
} from "../lib/todos";
import "./capture.css";

const hasDraft = (d: CaptureDraft) =>
  Boolean(d.text || d.notes || d.files.length || d.subject);
const fresh = (): CaptureDraft => ({
  id: crypto.randomUUID(),
  text: "",
  notes: "",
  files: [],
});
/** Core capture never depends on an addon or a mounted calendar page. A
 * failed write keeps the same intent ID, including on reopening its draft. */
export function QuickAdd({ onClose }: { onClose: () => void }) {
  const flags = useFeatures();
  const owner = useRef(sessionIdentity());
  const scope = useRef(captureSessionScope()).current;
  const [draft, setDraft] = useState<CaptureDraft>(fresh);
  const current = useRef(draft);
  current.current = draft;
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<"search" | "when" | "time">("search");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [minutes, setMinutesState] = useState(DEFAULT_TODO_MINUTES);
  const setMinutes = (value: number) => {
    if (locked.current) return;
    setMinutesState(value);
    setHighlight(0);
    setSubject((s) => (s ? { ...s, minutes: value } : s));
    setDraft((d) =>
      d.subject
        ? {
            ...d,
            attempt: undefined,
            subject: { ...d.subject, minutes: value },
          }
        : d,
    );
  };
  function backToSearch() {
    setSubject(null);
    setDraft((d) => ({ ...d, subject: undefined, attempt: undefined }));
    setStep("search");
    setHighlight(0);
  }
  const [highlight, setHighlight] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [activities, setActivities] = useState<ActivityResponse[]>([]);
  const [fetched, setFetched] = useState<TodayResponse | null>(null);
  const todayPlan = useTodayPlan();
  const account = useAccount();
  const today = fetched ?? todayPlan;
  const zone = today?.timeZone ?? account?.timeZone;
  const [tomorrow, setTomorrow] = useState<ScopeDay | null>(null);
  const todos = useTodos() ?? [];
  const addons = useInstalledAddons();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [occurrence, setOccurrence] = useState(0);
  const [now, setNow] = useState(Date.now);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const saved = useRef(false);
  const storageReady = useRef(false);
  const latestClose = async () => {
    if (locked.current || !ready) return;
    try {
      if (!storageReady.current && hasDraft(current.current))
        throw new Error("Draft storage unavailable");
      if (storageReady.current)
        await saveCaptureDraft(
          owner.current,
          hasDraft(current.current) ? current.current : null,
        );
      assertSessionScope(scope);
      onClose();
    } catch {
      setDraftError(
        "Could not keep this draft on this device. Save it or discard it before closing.",
      );
    }
  };
  useDialogFocus(root, () => void latestClose());
  useEffect(() => {
    let active = true;
    void readCaptureDraft(owner.current)
      .then((value) => {
        if (!active) return;
        storageReady.current = true;
        if (value) {
          setDraft(value);
          setNotesOpen(Boolean(value.notes));
          if (value.subject) {
            setSubject(value.subject);
            setMinutesState(value.subject.minutes);
            setStep("when");
          }
        }
      })
      .catch(() => {
        if (active)
          setDraftError(
            "Local draft storage is unavailable. Keep this window open until saved.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    void reloadTodos();
    void api
      .activities()
      .then((rows) => {
        if (active) setActivities(rows.filter((a) => a.isActive));
      })
      .catch(() => undefined);
    void api
      .today({ range: "working" })
      .then((day) => {
        if (active) setFetched(day);
      })
      .catch(() => undefined);
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!ready || saved.current || !storageReady.current) return;
    const timer = setTimeout(() => {
      if (saved.current) return;
      void saveCaptureDraft(
        owner.current,
        hasDraft(draft) ? draft : null,
      ).catch(() =>
        setDraftError(
          "Draft not saved locally. Keep this window open until saved.",
        ),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, ready]);
  const tomorrowDate = zone ? addLocalDays(dateIn(now, zone), 1) : null;
  useEffect(() => {
    if (!tomorrowDate) return;
    let active = true;
    void api
      .scope(tomorrowDate, 1)
      .then((scope) => {
        if (active) setTomorrow(scope.days[0] ?? null);
      })
      .catch(() => {
        if (active) setTomorrow(null);
      });
    return () => {
      active = false;
    };
  }, [tomorrowDate]);
  useEffect(() => {
    if (!date && zone) setDate(dateIn(Date.now(), zone));
  }, [date, zone]);
  useEffect(() => {
    if (ready) (step === "search" ? input.current : root.current)?.focus();
  }, [step, ready]);
  const chips = activities.slice(0, 5);
  const results = useMemo(() => {
    const text = draft.text.trim(),
      q = text.toLowerCase();
    const out: Subject[] = [];
    // Typed text always remains an explicit new capture, even when its name
    // resembles an existing todo. Search never silently schedules a duplicate.
    if (text || draft.files.length || draft.notes.trim())
      out.push({
        kind: "text",
        title:
          text ||
          draft.files[0]?.file.name ||
          draft.notes.trim().split("\n")[0]?.slice(0, 200) ||
          "Notes to review",
        minutes: DEFAULT_TODO_MINUTES,
      });
    if (q)
      out.push(
        ...activities
          .filter((a) => a.name.toLowerCase().includes(q))
          .slice(0, 5)
          .map((a) => ({
            kind: "activity" as const,
            id: a.id,
            title: a.name,
            minutes: a.sessionMinutes,
          })),
      );
    out.push(
      ...todos
        .filter((t) => !q || t.title.toLowerCase().includes(q))
        .slice(0, 6)
        .map((t) => ({
          kind: "todo" as const,
          id: t.id,
          title: t.title,
          minutes: t.minutes ?? DEFAULT_TODO_MINUTES,
        })),
    );
    return out;
  }, [draft.text, draft.files, draft.notes, activities, todos]);
  const choose = (s: Subject) => {
    if (locked.current || !ready) return;
    setDraft((d) => ({ ...d, subject: s, attempt: undefined }));
    setSubject(s);
    setMinutes(s.minutes);
    setHighlight(0);
    setStep("when");
    setError("");
  };
  const rows = suggestionsFor(minutes, today, tomorrow, now);
  const plain =
    subject?.kind === "text" &&
    !draft.files.length &&
    !draft.notes.trim() &&
    !linksIn(subject.title).length;
  const keepRows = plain
    ? [...addons.values()].flatMap((a) =>
        isServing(a.manifest.id)
          ? a.manifest.quickAdd.map((c) => ({
              addonId: a.manifest.id,
              key: c.key,
              name: c.name,
              // The addon by name, for the row's second line. "via addon" said
              // only that something outside the app would handle it, which is
              // machinery; which addon is the part the user can act on.
              from: a.manifest.name,
            }))
          : [],
      )
    : [];
  const addFiles = (files: File[]) => {
    if (locked.current || !ready) return;
    if (!flags.capture_files) {
      setError("File attachments are not available yet.");
      return;
    }
    const next = [
      ...draft.files,
      ...files.map((file) => ({ file, id: crypto.randomUUID() })),
    ];
    if (
      next.length > 10 ||
      next.some((f) => f.file.size > 5 * 1024 * 1024) ||
      next.reduce((sum, f) => sum + f.file.size, 0) > 20 * 1024 * 1024
    ) {
      setError("Up to 10 files, 5 MiB each and 20 MiB per todo.");
      return;
    }
    setDraft((d) => ({ ...d, attempt: undefined, files: next }));
    setError("");
  };
  const save = async (what: Subject, at?: number, length = minutes) => {
    if (locked.current || !ready) return;
    if (!flags.quick_capture) {
      setError(
        "Capture is not currently available. Your draft is kept on this device.",
      );
      return;
    }
    if (draft.files.length && !flags.capture_files) {
      setError(
        "File uploads are unavailable. Keep this draft for later, or explicitly remove its files before saving.",
      );
      return;
    }
    if (what.kind === "todo" && (draft.files.length || draft.notes.trim())) {
      setError(
        "Choose the new capture row to keep these notes and files, or edit the existing item from the inbox.",
      );
      return;
    }
    if (!Number.isInteger(length) || length < 1 || length > 480) {
      setError("Choose 1–480 minutes.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    const pendingDraft = {
      ...current.current,
      subject: { ...what, minutes: length },
      attempt: {
        ...(at !== undefined ? { startsAt: at } : {}),
        minutes: length,
      },
    };
    current.current = pendingDraft;
    setDraft(pendingDraft);
    try {
      assertSessionScope(scope);
      if (storageReady.current)
        await saveCaptureDraft(owner.current, {
          ...current.current,
          subject: { ...what, minutes: length },
        }).catch(() =>
          setDraftError("Local draft save failed; attempting to save online."),
        );
      assertSessionScope(scope);
      {
        const links = linksIn(`${what.title}\n${draft.notes}`);
        const title =
          what.title.length > 200 && links.length === 1
            ? new URL(links[0] ?? "").hostname
            : what.title.length > 200
              ? `${what.title.slice(0, 197)}…`
              : what.title;
        const notes =
          what.title.length > 200
            ? `${what.title}\n\n${draft.notes}`.trim()
            : draft.notes;
        if (notes.length > 10000)
          throw new Error(
            "Keep notes under 10,000 characters, or attach the text as a file.",
          );
        // Removed selections must not keep consuming this intent's staging
        // quota. Claimed files survive this reset; retries keep the same IDs.
        if (draft.files.length) await api.discardCaptureFiles(draft.id, scope);
        for (const f of draft.files) {
          await api.uploadCaptureFile(draft.id, f.id, f.file, scope);
        }
        await api.capture(
          {
            id: draft.id,
            title,
            notes,
            links,
            minutes: length,
            fileIds: draft.files.map((f) => f.id),
            ...(what.kind === "activity" ? { activityId: what.id } : {}),
            ...(what.kind === "todo" ? { todoId: what.id } : {}),
            ...(at !== undefined ? { startsAt: at } : {}),
          },
          scope,
        );
      }
      assertSessionScope(scope);
      saved.current = true;
      try {
        if (storageReady.current) await saveCaptureDraft(owner.current, null);
      } catch {
        assertSessionScope(scope);
        notify(
          "Saved. Local draft cleanup failed; check the inbox before retrying.",
        );
      }
      assertSessionScope(scope);
      notify(
        at === undefined
          ? "Saved to inbox"
          : `${what.title} · ${new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(at)}`,
      );
      refreshCaptured();
      onClose();
    } catch (cause) {
      setError(message(cause));
      if (storageReady.current)
        void saveCaptureDraft(owner.current, current.current).catch(() =>
          setDraftError("Local draft storage failed. Keep this window open."),
        );
      refreshCaptured();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const saveNew = () => {
    if (
      step === "search" &&
      !draft.text.trim() &&
      !draft.notes.trim() &&
      !draft.files.length
    )
      return;
    const what = step === "search" ? results[0] : subject;
    if (what) void save(what);
  };
  const drop = (a: ActivityResponse) => {
    const at = fitsAt(a.sessionMinutes, today, Date.now());
    if (at === null)
      return setError("No gap today. Choose a date or save to the inbox.");
    void save(
      { kind: "activity", id: a.id, title: a.name, minutes: a.sessionMinutes },
      at,
      a.sessionMinutes,
    );
  };
  const pickTime = () => {
    try {
      if (!zone) throw new Error("Loading your account time zone…");
      if (subject)
        void save(
          subject,
          pickedTime(date, time, zone, Date.now(), occurrence),
        );
    } catch (cause) {
      setError(message(cause));
    }
  };
  const run = (index: number) => {
    if (!subject) return;
    if (index < rows.length) {
      const row = rows[index];
      if (row?.at !== null && row?.at !== undefined) void save(subject, row.at);
    } else if (index === rows.length) void save(subject);
    else setStep("time");
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      event.preventDefault();
      if (busy) return;
      if (step === "search") void latestClose();
      else setStep(step === "time" ? "when" : "search");
      return;
    }
    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      void latestClose();
      return;
    }
    if (busy) return;
    if ((mod || event.altKey) && event.key === "Enter") {
      event.preventDefault();
      saveNew();
      return;
    }
    if (mod && /^[1-5]$/.test(event.key) && step === "search") {
      event.preventDefault();
      const a = chips[Number(event.key) - 1];
      if (a) drop(a);
      return;
    }
    // Leave native input editing, button activation and Tab alone.
    if (event.target !== root.current && event.target !== input.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const n = step === "search" ? results.length : rows.length + 2;
      if (!n) return;
      event.preventDefault();
      setHighlight((h) => (h + (event.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (step === "search") {
        const s = results[highlight] ?? results[0];
        if (s) choose(s);
      } else if (step === "when") run(highlight);
      else pickTime();
    }
  };
  const occurrences = zone ? wallTimes(date, time, zone) : [];
  return createPortal(
    <div className="wr-overlay wr-palette-overlay wr-capture-overlay">
      <button
        type="button"
        className="wr-overlay-back"
        aria-label="Close quick add"
        onClick={() => void latestClose()}
      />
      <div
        ref={root}
        className="wr-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Quick add"
        tabIndex={-1}
        onKeyDown={onKey}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (locked.current || !ready) return;
          const files = Array.from(event.dataTransfer.files);
          if (files.length) {
            addFiles(files);
            return;
          }
          const text = (
            event.dataTransfer
              .getData("text/uri-list")
              .split(/\r?\n/)
              .filter((s) => !s.startsWith("#"))
              .join("\n") || event.dataTransfer.getData("text/plain")
          ).trim();
          if (!text) return;
          if (step === "search" && !draft.text)
            setDraft((d) => ({
              ...d,
              text,
              subject: undefined,
              attempt: undefined,
            }));
          else {
            setDraft((d) => ({
              ...d,
              notes: [d.notes, text].filter(Boolean).join("\n"),
              attempt: undefined,
            }));
            setNotesOpen(true);
          }
        }}
        onPaste={(event) => {
          if (event.clipboardData.files.length) {
            event.preventDefault();
            addFiles(Array.from(event.clipboardData.files));
          }
        }}
      >
        <div className="wr-palette-head">
          <span className="wr-palette-dot" aria-hidden="true" />
          {step === "search" ? (
            <input
              ref={input}
              className="wr-palette-input"
              aria-label="What to add"
              placeholder={
                flags.capture_files
                  ? "Add a task, paste a link, or drop files"
                  : "Add a task or paste a link"
              }
              disabled={!ready || busy}
              value={draft.text}
              onChange={(event) => {
                setSubject(null);
                setDraft((d) => ({
                  ...d,
                  subject: undefined,
                  attempt: undefined,
                  text: event.target.value,
                }));
                setHighlight(0);
              }}
            />
          ) : (
            <div className="wr-palette-input">{subject?.title}</div>
          )}
          <button
            type="button"
            className="wr-palette-pill"
            onClick={() => void latestClose()}
            disabled={busy}
          >
            Close
          </button>
        </div>
        <fieldset
          className="wr-palette-body"
          disabled={busy || !ready}
          aria-label="Capture details"
        >
          {error ? (
            <p role="alert" className="wr-capture-error">
              {error}
            </p>
          ) : null}
          {draftError ? <p role="status">{draftError}</p> : null}
          {step !== "search" && (draft.files.length || draft.notes) ? (
            <small>
              Includes {draft.files.length} files
              {draft.notes ? " and notes" : ""}. Back to edit.
            </small>
          ) : null}
          {draft.attempt && draft.subject && !busy ? (
            <div className="wr-capture-form">
              <p>
                A previous save is unconfirmed. Retry its original time before
                making a new appointment.
              </p>
              <button
                type="button"
                className="wr-palette-pill"
                onClick={() => {
                  if (draft.subject && draft.attempt)
                    void save(
                      draft.subject,
                      draft.attempt.startsAt,
                      draft.attempt.minutes,
                    );
                }}
              >
                Retry previous save
              </button>
            </div>
          ) : null}
          {step === "search" ? (
            <>
              <div className="wr-capture-actions">
                {flags.capture_files ? (
                  <button
                    type="button"
                    className="wr-palette-pill"
                    disabled={busy || !ready}
                    onClick={() => fileInput.current?.click()}
                  >
                    Attach files
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wr-palette-pill"
                  disabled={busy || !ready}
                  onClick={() => setNotesOpen((value) => !value)}
                >
                  {notesOpen
                    ? "Hide notes"
                    : draft.notes
                      ? "Show notes"
                      : "Add notes"}
                </button>
              </div>
              {notesOpen ? (
                <label className="wr-capture-label">
                  Notes (optional)
                  <textarea
                    rows={2}
                    maxLength={10000}
                    value={draft.notes}
                    disabled={busy || !ready}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        attempt: undefined,
                        notes: e.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
              {flags.capture_files ? (
                <input
                  ref={fileInput}
                  hidden
                  aria-label="Attach files"
                  type="file"
                  multiple
                  disabled={busy || !ready}
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              ) : null}
              {/* Only once there is something to measure. The header already
                  says files can be dropped or pasted, so on an empty palette
                  this was a sentence of limits about an act nobody had
                  performed - the first thing the eye landed on, and the least
                  useful. */}
              {draft.files.length ? (
                <small>
                  {draft.files.length} of 10 files · 5 MiB each · 20 MiB total.
                </small>
              ) : null}
              {draft.files.map((f) => (
                <div className="wr-capture-file" key={f.id}>
                  <span>
                    {f.file.name} · {Math.ceil(f.file.size / 1024)} KiB
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    className="wr-palette-pill"
                    aria-label={`Remove ${f.file.name}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        files: d.files.filter((x) => x.id !== f.id),
                        attempt: undefined,
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {!draft.text.trim() && !draft.files.length ? (
                <>
                  {/* Unlabelled, a lone "Stretch 1" chip on an empty palette
                      reads as a stray tag rather than a thing to press. */}
                  <p className="wr-palette-kicker">
                    <span>Place one of yours</span>
                    <span>{chips.length > 1 ? `1–${chips.length}` : "1"}</span>
                  </p>
                  <div className="wr-palette-chips">
                    {chips.map((a, i) => (
                      <button
                        type="button"
                        key={a.id}
                        className="wr-palette-chip"
                        onClick={() =>
                          choose({
                            kind: "activity",
                            id: a.id,
                            title: a.name,
                            minutes: a.sessionMinutes,
                          })
                        }
                      >
                        {a.name} <Keycap>{i + 1}</Keycap>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {results.map((s, i) => (
                <button
                  type="button"
                  key={s.kind === "text" ? "new" : `${s.kind}/${s.id}`}
                  className={`wr-palette-row${i === highlight ? " wr-palette-row-on" : ""}`}
                  disabled={busy || !ready}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(s)}
                >
                  <span className="wr-palette-text">
                    <span className="wr-palette-title">{s.title}</span>
                    <span className="wr-palette-note">
                      {s.kind === "text"
                        ? // "or save to inbox" was the other half of this
                          // sentence until that became the row directly below,
                          // naming itself.
                          "New capture · choose when"
                        : `${s.minutes} min · ${s.kind}`}
                    </span>
                  </span>
                  <Keycap>↵</Keycap>
                </button>
              ))}
              {/* A row, not a filled bar. It was the loudest thing on the
                  screen while being the lesser of the two choices - the
                  highlighted result above it is what ↵ does, and what most
                  captures want. It is also the same action the next step
                  offers, so it reads the same on both. */}
              <button
                type="button"
                className="wr-palette-row"
                disabled={
                  busy ||
                  !ready ||
                  !(
                    draft.text.trim() ||
                    draft.notes.trim() ||
                    draft.files.length
                  )
                }
                onClick={() => {
                  const s = results[0];
                  if (s) void save(s, undefined, s.minutes);
                }}
              >
                <span className="wr-palette-text">
                  <span className="wr-palette-title">Save to inbox</span>
                  <span className="wr-palette-note">
                    Keep it without a time
                  </span>
                </span>
                <Keycap>⌘↵</Keycap>
              </button>
            </>
          ) : null}
          {step === "when" ? (
            <>
              <div className="wr-palette-pills">
                {durationsFor(subject?.minutes ?? 15).map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={busy}
                    className={`wr-palette-pill${d === minutes ? " wr-palette-pill-on" : ""}`}
                    onClick={() => setMinutes(d)}
                  >
                    {d} min
                  </button>
                ))}
                {/* One more pill in the same row, not a stacked form field.
                    `wr-capture-label` is a grid with its caption above a
                    full-width input - correct on the date form, and in a row
                    of pills it put a second baseline and a stretched box
                    beside four round chips. The caption is the unit. */}
                <span className="wr-palette-pill wr-palette-pill-field">
                  <input
                    type="number"
                    min={1}
                    max={480}
                    aria-label="Minutes"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    disabled={busy}
                  />
                  min
                </span>
              </div>
              {rows.map((row, i) => (
                <button
                  key={row.key}
                  type="button"
                  disabled={busy}
                  className={`wr-palette-row${highlight === i ? " wr-palette-row-on" : ""}`}
                  onClick={() => run(i)}
                >
                  <span className="wr-palette-when">{row.when}</span>
                  <span className="wr-palette-text">
                    <span className="wr-palette-title">{row.title}</span>
                    <span className="wr-palette-note">{row.note}</span>
                  </span>
                </button>
              ))}
              {/* The same two columns as the rows above, with the time column
                  left empty rather than dropped: these three are the choices
                  that have no time, and a row that omits the column starts its
                  title 56px to the left of the one above it. That ragged edge
                  is what made the list read as two unrelated groups. */}
              <button
                type="button"
                className="wr-palette-row"
                disabled={busy}
                onClick={() => saveNew()}
              >
                <span className="wr-palette-when" aria-hidden="true" />
                <span className="wr-palette-text">
                  <span className="wr-palette-title">Save to inbox</span>
                  <span className="wr-palette-note">
                    Keep it without a time
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="wr-palette-row"
                disabled={busy || !zone}
                onClick={() => setStep("time")}
              >
                <span className="wr-palette-when" aria-hidden="true" />
                <span className="wr-palette-text">
                  <span className="wr-palette-title">Choose date and time</span>
                  <span className="wr-palette-note">Put it where you want</span>
                </span>
              </button>
              {keepRows.map((row) => (
                <button
                  key={`${row.addonId}/${row.key}`}
                  type="button"
                  className="wr-palette-row"
                  disabled={busy}
                  onClick={() => {
                    if (!subject || locked.current) return;
                    try {
                      assertSessionScope(scope);
                    } catch (error) {
                      setError(message(error));
                      return;
                    }
                    locked.current = true;
                    setBusy(true);
                    void dispatchQuickAdd(row.addonId, {
                      key: row.key,
                      title: subject.title,
                      minutes,
                    })
                      .then(async (answer) => {
                        assertSessionScope(scope);
                        if (!answer.ok)
                          throw new Error(
                            answer.message ??
                              "The addon could not save this capture.",
                          );
                        saved.current = true;
                        await saveCaptureDraft(owner.current, null);
                        assertSessionScope(scope);
                        notify(answer.message ?? "Saved by addon");
                        refreshCaptured();
                        onClose();
                      })
                      .catch((e) => setError(message(e)))
                      .finally(() => {
                        locked.current = false;
                        setBusy(false);
                      });
                  }}
                >
                  <span className="wr-palette-when" aria-hidden="true" />
                  <span className="wr-palette-text">
                    <span className="wr-palette-title">{row.name}</span>
                    <span className="wr-palette-note">From {row.from}</span>
                  </span>
                </button>
              ))}
            </>
          ) : null}
          {step === "time" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                pickTime();
              }}
              className="wr-capture-form"
            >
              {/* The only line in the palette that was body text on its own -
                  it is a caption for the two fields under it, and now says so
                  in the same voice as the other section label. */}
              <p className="wr-palette-kicker">
                <span>Pick a time</span>
                <span>
                  {zone} · {minutes} min
                </span>
              </p>
              <label className="wr-capture-label">
                Day
                <input
                  type="date"
                  required
                  value={date}
                  min={zone ? dateIn(now, zone) : undefined}
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
                  onChange={(e) => {
                    setTime(e.target.value);
                    setOccurrence(0);
                  }}
                />
              </label>
              {occurrences.length > 1 ? (
                <label className="wr-capture-label">
                  This time occurs twice
                  <select
                    value={occurrence}
                    onChange={(e) => setOccurrence(Number(e.target.value))}
                  >
                    <option value={0}>First occurrence</option>
                    <option value={1}>Second occurrence</option>
                  </select>
                </label>
              ) : null}
              <button
                type="submit"
                className="wr-palette-pill wr-palette-pill-on"
                disabled={busy}
              >
                Place
              </button>
            </form>
          ) : null}
          {busy ? <p role="status">Saving… Keep this window open.</p> : null}
        </fieldset>
        <div className="wr-palette-foot">
          <span>⌘/Ctrl Enter · inbox</span>
          <span>Tab · next control</span>
          <button
            type="button"
            className="wr-palette-pill"
            disabled={busy}
            onClick={() => {
              if (step !== "search") {
                backToSearch();
                return;
              }
              void (
                storageReady.current
                  ? saveCaptureDraft(owner.current, null)
                  : Promise.resolve()
              )
                .then(() => {
                  assertSessionScope(scope);
                  saved.current = true;
                  void api
                    .discardCaptureFiles(draft.id, scope)
                    .catch(() => undefined);
                  onClose();
                })
                .catch(() =>
                  setDraftError("Could not discard the local draft."),
                );
            }}
          >
            {step === "search" ? "Discard draft" : "Back"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
