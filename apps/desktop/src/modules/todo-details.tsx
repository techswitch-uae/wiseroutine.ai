import { useEffect, useRef, useState } from "react";
import { api, type TodoDetails as Details } from "../lib/api";
import {
  captureError,
  dateIn,
  downloadTodoFile,
  pickedTime,
  refreshCaptured,
  wallTimes,
} from "../lib/capture";
import { useFeatures } from "../lib/features";
import { openExternal } from "../lib/open-external";
import { clockIn } from "../lib/quick-add";
import {
  assertSessionScope,
  captureSessionScope,
  type SessionScope,
} from "../lib/session-lifecycle";
import { CaptureModal } from "./capture-modal";
import { Reschedule } from "./reschedule";
import "./capture.css";

export function TodoDetails({
  id,
  timeZone,
  onClose,
}: {
  id: string;
  timeZone: string;
  onClose: () => void;
}) {
  const flags = useFeatures();
  const scope = useRef(captureSessionScope()).current;
  const [todo, setTodo] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const loadSequence = useRef(0);
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [moving, setMoving] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [remove, setRemove] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; file: File }[]>([]);
  const hasUnsaved = Boolean(
    pending.length ||
      (editing &&
        todo &&
        (title !== todo.title ||
          notes !== todo.notes ||
          links !== todo.links.join("\n") ||
          minutes !== (todo.minutes ?? 15))),
  );
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);
  const load = async () => {
    const sequence = ++loadSequence.current;
    try {
      const value = await api.todoDetails(id, scope);
      assertSessionScope(scope);
      if (sequence === loadSequence.current) setTodo(value);
      return value;
    } catch (error) {
      if (sequence === loadSequence.current) throw error;
    }
  };
  useEffect(() => {
    let active = true;
    const sequence = ++loadSequence.current;
    void api
      .todoDetails(id, scope)
      .then((value) => {
        if (active && sequence === loadSequence.current) setTodo(value);
      })
      .catch((e) => {
        if (active && sequence === loadSequence.current)
          setError(e instanceof Error ? e.message : "Couldn't read this todo");
      });
    return () => {
      active = false;
      loadSequence.current++;
    };
  }, [id, scope]);
  const act = async (work: () => Promise<unknown>, mutation = true) => {
    if (locked.current) return;
    if (mutation) loadSequence.current++;
    locked.current = true;
    setBusy(true);
    setConfirmClose(false);
    setError("");
    try {
      assertSessionScope(scope);
      await work();
      assertSessionScope(scope);
      if (mutation) refreshCaptured();
    } catch (e) {
      setError(captureError(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const upload = (items: typeof pending) =>
    void act(async () => {
      for (const item of items) {
        const file = await api.addTodoFile(id, item.id, item.file, scope);
        assertSessionScope(scope);
        setTodo((t) =>
          t
            ? {
                ...t,
                files: [...t.files.filter((f) => f.id !== file.id), file],
              }
            : t,
        );
        setPending((p) => p.filter((f) => f.id !== item.id));
      }
    });
  if (moving && todo?.slot)
    return (
      <Reschedule
        slot={todo.slot}
        timeZone={timeZone}
        onClose={() => setMoving(false)}
        onSaved={() => {
          void load().catch(() => undefined);
        }}
      />
    );
  return (
    <CaptureModal
      title={todo?.title ?? "Todo"}
      onClose={() => {
        if (locked.current) return;
        if (hasUnsaved) setConfirmClose(true);
        else onClose();
      }}
    >
      {error ? (
        <p role="alert" className="wr-capture-error">
          {error}
        </p>
      ) : null}
      {confirmClose ? (
        <div role="alert">
          <p>
            There are unsaved edits or unuploaded files. Already saved changes
            will be kept.
          </p>
          <div className="wr-capture-actions">
            <button
              type="button"
              className="wr-palette-pill"
              disabled={busy}
              onClick={onClose}
            >
              Discard unsaved changes and close
            </button>
            <button
              type="button"
              className="wr-palette-pill"
              onClick={() => setConfirmClose(false)}
            >
              Keep editing
            </button>
          </div>
        </div>
      ) : null}
      {!todo ? (
        <p>Loading…</p>
      ) : editing ? (
        <form
          className="wr-capture-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.editTodo(
                id,
                {
                  title,
                  notes,
                  links: links
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  minutes,
                },
                scope,
              );
              await load();
              setEditing(false);
            });
          }}
        >
          <label className="wr-capture-label">
            Title
            <input
              required
              maxLength={200}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="wr-capture-label">
            Notes
            <textarea
              rows={5}
              maxLength={10000}
              value={notes}
              disabled={busy}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="wr-capture-label">
            Links (one per line)
            <textarea
              value={links}
              disabled={busy}
              onChange={(e) => setLinks(e.target.value)}
            />
          </label>
          <label className="wr-capture-label">
            Minutes
            <input
              type="number"
              min={1}
              max={480}
              required
              value={minutes}
              disabled={busy || todo.status === "slotted"}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          {todo.status === "slotted" ? (
            <small>
              Use Postpone / change time to change the scheduled duration.
            </small>
          ) : null}
          <div className="wr-capture-actions">
            <button
              type="submit"
              className="wr-palette-pill wr-palette-pill-on"
              disabled={busy}
            >
              Save changes
            </button>
            <button
              type="button"
              className="wr-palette-pill"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel edit
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            {todo.status === "open"
              ? "In your inbox · no time yet"
              : todo.slot && todo.status === "slotted"
                ? new Intl.DateTimeFormat(undefined, {
                    timeZone,
                    dateStyle: "full",
                    timeStyle: "short",
                  }).format(todo.slot.startsAt)
                : todo.status}{" "}
            · {todo.minutes ?? 15} min
          </p>
          {todo.notes ? (
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {todo.notes}
            </p>
          ) : null}
          {todo.links.map((link) => (
            <div className="wr-capture-file" key={link}>
              <button
                type="button"
                className="wr-inbox-title"
                onClick={() =>
                  void act(async () => {
                    if (!(await openExternal(link)))
                      throw new Error("Couldn't open that link");
                  }, false)
                }
              >
                {link} ↗
              </button>
            </div>
          ))}
          {todo.files.map((file) => (
            <div className="wr-capture-file" key={file.id}>
              <span>
                {file.name} · {Math.ceil(file.size / 1024)} KiB
              </span>
              <button
                type="button"
                className="wr-palette-pill"
                disabled={busy}
                onClick={() =>
                  void act(() => downloadTodoFile(id, file, scope), false)
                }
              >
                Download
              </button>
              <button
                type="button"
                className="wr-palette-pill"
                disabled={busy}
                onClick={() => {
                  if (remove !== file.id) {
                    setRemove(file.id);
                    return;
                  }
                  void act(async () => {
                    await api.deleteTodoFile(id, file.id, scope);
                    setTodo((t) =>
                      t
                        ? {
                            ...t,
                            files: t.files.filter((f) => f.id !== file.id),
                          }
                        : t,
                    );
                    setRemove(null);
                  });
                }}
              >
                {remove === file.id ? "Delete file permanently" : "Remove file"}
              </button>
            </div>
          ))}
          <small>
            Downloads are not executed automatically. Open files only if you
            trust their source.
          </small>
          {flags.capture_files ? (
            <label className="wr-capture-label">
              Add files
              <input
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.some((f) => f.size > 5 * 1024 * 1024)) {
                    setError("Each file must be at most 5 MiB.");
                    return;
                  }
                  const items = [
                    ...pending,
                    ...files.map((file) => ({ id: crypto.randomUUID(), file })),
                  ];
                  if (
                    todo.files.length + items.length > 10 ||
                    [...todo.files, ...items.map((item) => item.file)].reduce(
                      (size, file) => size + file.size,
                      0,
                    ) >
                      20 * 1024 * 1024
                  ) {
                    setError(
                      "Keep at most 10 files and 20 MiB per todo. Remove files before adding more.",
                    );
                    return;
                  }
                  setPending(items);
                  upload(items);
                }}
              />
            </label>
          ) : null}
          {flags.capture_files && pending.length ? (
            <p>
              Unconfirmed uploads: {pending.map((f) => f.file.name).join(", ")}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => upload(pending)}
              >
                Retry uploads
              </button>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPending([]);
                  setConfirmClose(false);
                  void load().catch(() =>
                    setError(
                      "Refresh this todo to check which files were saved.",
                    ),
                  );
                }}
              >
                Clear retry queue (keep saved files)
              </button>
            </p>
          ) : null}
          <div className="wr-capture-actions">
            <button
              type="button"
              className="wr-palette-pill"
              disabled={busy}
              onClick={() => {
                setTitle(todo.title);
                setNotes(todo.notes);
                setLinks(todo.links.join("\n"));
                setMinutes(todo.minutes ?? 15);
                setEditing(true);
              }}
            >
              Edit details
            </button>
            {todo.status === "open" || todo.status === "slotted" ? (
              <>
                {todo.slot ? (
                  <button
                    type="button"
                    className="wr-palette-pill"
                    disabled={busy}
                    onClick={() => setMoving(true)}
                  >
                    Postpone / change time
                  </button>
                ) : flags.quick_capture ? (
                  <PlanTodo
                    todo={todo}
                    scope={scope}
                    timeZone={timeZone}
                    disabled={busy}
                    onSaved={() => {
                      void load().catch(() => undefined);
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  className="wr-palette-pill wr-palette-pill-on"
                  disabled={busy || pending.length > 0}
                  onClick={() =>
                    void act(async () => {
                      await api.setTodo(id, "done", undefined, scope);
                      assertSessionScope(scope);
                      onClose();
                    })
                  }
                >
                  Mark done
                </button>
                <button
                  type="button"
                  className="wr-palette-pill"
                  disabled={busy || pending.length > 0}
                  onClick={() =>
                    void act(async () => {
                      await api.setTodo(id, "dropped", undefined, scope);
                      assertSessionScope(scope);
                      onClose();
                    })
                  }
                >
                  Drop from inbox
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </CaptureModal>
  );
}

function PlanTodo({
  todo,
  timeZone,
  onSaved,
  disabled,
  scope,
}: {
  todo: Details;
  scope: SessionScope;
  timeZone: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => dateIn(Date.now(), timeZone));
  const [time, setTime] = useState(() =>
    clockIn(Math.ceil(Date.now() / 300000) * 300000, timeZone),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const id = useRef(crypto.randomUUID());
  const [occurrence, setOccurrence] = useState(0);
  const times = wallTimes(date, time, timeZone);
  if (!open)
    return (
      <button
        type="button"
        className="wr-palette-pill"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Plan a time
      </button>
    );
  return (
    <CaptureModal
      title="Plan todo"
      onClose={() => {
        if (!lock.current) setOpen(false);
      }}
    >
      <form
        className="wr-capture-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (lock.current) return;
          let at: number;
          try {
            at = pickedTime(date, time, timeZone, Date.now(), occurrence);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Choose a time");
            return;
          }
          lock.current = true;
          setBusy(true);
          void api
            .capture(
              {
                id: id.current,
                todoId: todo.id,
                title: todo.title,
                notes: "",
                links: [],
                minutes: todo.minutes ?? 15,
                fileIds: [],
                startsAt: at,
              },
              scope,
            )
            .then(() => {
              assertSessionScope(scope);
              setOpen(false);
              refreshCaptured();
              onSaved();
            })
            .catch((cause) =>
              setError(captureError(cause, "Couldn't plan this todo")),
            )
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <p>
          {timeZone} · {todo.minutes ?? 15} min
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <label className="wr-capture-label">
          Day
          <input
            type="date"
            required
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="wr-capture-label">
          Time
          <input
            type="time"
            required
            value={time}
            disabled={busy}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        {times.length === 2 ? (
          <label className="wr-capture-label">
            This time occurs twice
            <select
              value={occurrence}
              disabled={busy}
              onChange={(e) => setOccurrence(Number(e.target.value))}
            >
              <option value={0}>First occurrence</option>
              <option value={1}>Second occurrence (one hour later)</option>
            </select>
          </label>
        ) : null}
        <button
          type="submit"
          className="wr-palette-pill wr-palette-pill-on"
          disabled={busy}
        >
          Plan todo
        </button>
      </form>
    </CaptureModal>
  );
}
