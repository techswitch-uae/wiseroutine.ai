import { addDays, isoOf, Keycap } from "@wiseroutine/design";
import { instantFromLocal } from "@wiseroutine/scheduler";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchQuickAdd, isServing } from "../addons/host";
import { useInstalledAddons } from "../addons/installed";
import {
  type ActivityResponse,
  ApiError,
  api,
  deviceTimeZone,
  type ScopeDay,
  type TodayResponse,
} from "../lib/api";
import { notify } from "../lib/notify";
import { owedToday } from "../lib/owed";
import { reloadPlan, todaySnapshot, useTodayPlan } from "../lib/plan-store";
import {
  clockIn,
  durationsFor,
  type Suggestion,
  suggestionsFor,
} from "../lib/quick-add";
import { todayOf } from "../lib/scope";
import {
  DEFAULT_TODO_MINUTES,
  fitsAt,
  reloadTodos,
  useTodos,
} from "../lib/todos";

/**
 * Quick add: one field, one choice.
 *
 * ⌘K anywhere, type or press a chip, then say when. What was typed is not a
 * slot or a todo until the "when" is answered: a time makes it a slot, and
 * "no time yet" hands it to whichever addon offered to keep it - see
 * `quickAdd` in the manifest. The dialog itself never stores anything.
 *
 * Three steps, one keyboard:
 *
 * - **search** - the field. Chips for the five activities most worth
 *   dropping, ⌘1–5 to drop one at the next mark with no second keystroke,
 *   and the todos waiting underneath. Typing narrows both.
 * - **when** - where it fits: the next gap that takes it, the one after, the
 *   first gap tomorrow, a picker, and the addons' rows. Digits pick a row,
 *   Tab cycles the length, ↵ takes the highlighted one.
 * - **time** - a day and a time, for when none of the above is right.
 *
 * Every instant here is the user's zone, never the device's - the picker
 * goes through `instantFromLocal` for exactly that reason.
 */

type Subject =
  | { kind: "activity"; id: string; title: string; minutes: number }
  | { kind: "todo"; id: string; title: string; minutes: number }
  | { kind: "text"; title: string; minutes: number };

/** Whether `needle` is somewhere in `hay`, case aside. */
const matches = (hay: string, needle: string): boolean =>
  hay.toLowerCase().includes(needle.trim().toLowerCase());

export const QuickAdd: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [text, setText] = useState("");
  const [step, setStep] = useState<"search" | "when" | "time">("search");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [minutes, setMinutes] = useState(DEFAULT_TODO_MINUTES);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);

  const [activities, setActivities] = useState<ActivityResponse[]>([]);
  const todayPlan = useTodayPlan();
  const [fetched, setFetched] = useState<TodayResponse | null>(null);
  const today = todayPlan ?? fetched;
  const [tomorrow, setTomorrow] = useState<ScopeDay | null>(null);
  const todos = useTodos() ?? [];
  const addons = useInstalledAddons();

  const [date, setDate] = useState(() => isoOf(addDays(todayOf(), 1)));
  const [time, setTime] = useState("09:00");

  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Everything the dialog reads, asked for once, on open. The day it has is
  // the one the shell holds; a page that never loaded one gets it fetched.
  useEffect(() => {
    void reloadTodos();
    api
      .activities()
      .then((all) => setActivities(all.filter((a) => a.isActive)))
      .catch(() => undefined);
    // The snapshot, not the hook's value: this runs on open only, and the
    // plan arriving later must not refetch it.
    if (!todaySnapshot())
      api
        .today()
        .then(setFetched)
        .catch(() => undefined);
    api
      .scope(isoOf(addDays(todayOf(), 1)), 1)
      .then((scope) => setTomorrow(scope.days[0] ?? null))
      .catch(() => undefined);
  }, []);

  // The keyboard goes where the step is. The field in search; the sheet
  // itself otherwise, so digits and arrows have somewhere to land.
  useEffect(() => {
    (step === "search" ? input.current : root.current)?.focus();
  }, [step]);

  const now = Date.now();
  const tz = today?.timeZone ?? deviceTimeZone();

  /** The five chips: owed today first, then the rest of the routine. */
  const chips = useMemo(() => {
    const owed = owedToday(today?.progress ?? []).map((o) => o.id);
    return [...activities]
      .sort((a, b) => {
        const ai = owed.indexOf(a.id);
        const bi = owed.indexOf(b.id);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      })
      .slice(0, 5);
  }, [activities, today]);

  /** What the field offers: matches for the text, or the waiting todos. */
  const results = useMemo((): Subject[] => {
    const query = text.trim();
    const todoRows = todos
      .filter((t) => !query || matches(t.title, query))
      .map(
        (t): Subject => ({
          kind: "todo",
          id: t.id,
          title: t.title,
          minutes: t.minutes ?? DEFAULT_TODO_MINUTES,
        }),
      );
    if (!query) return todoRows.slice(0, 6);
    const activityRows = activities
      .filter((a) => matches(a.name, query))
      .map(
        (a): Subject => ({
          kind: "activity",
          id: a.id,
          title: a.name,
          minutes: a.sessionMinutes,
        }),
      );
    return [
      ...activityRows.slice(0, 5),
      ...todoRows.slice(0, 5),
      { kind: "text", title: query, minutes: DEFAULT_TODO_MINUTES },
    ];
  }, [text, todos, activities]);

  /** The addons' rows - only for text, and only for an addon that is up to
   *  hear it. A todo is already a todo; an activity is not one. */
  const keepRows = useMemo((): Suggestion[] => {
    if (subject?.kind !== "text") return [];
    return [...addons.values()].flatMap((addon) =>
      isServing(addon.manifest.id)
        ? addon.manifest.quickAdd.map(
            (c): Suggestion => ({
              key: `${addon.manifest.id}/${c.key}`,
              when: "—",
              title: c.name,
              note: "No time yet",
              at: null,
              action: { addonId: addon.manifest.id, key: c.key },
              dashed: true,
            }),
          )
        : [],
    );
  }, [addons, subject]);

  // Per render, not memoised: three gaps and a spread are cheaper than the
  // dependency list that would keep `now` honest.
  const rows: Suggestion[] =
    step === "when"
      ? [
          ...suggestionsFor(minutes, today, tomorrow, now),
          {
            key: "time",
            when: "Pick",
            title: "Another day, another time",
            note: "Opens the picker",
            at: null,
            action: "time",
          },
          ...keepRows,
        ]
      : [];

  const durations = durationsFor(subject?.minutes ?? DEFAULT_TODO_MINUTES);

  const choose = (next: Subject) => {
    setSubject(next);
    setMinutes(next.minutes);
    setHighlight(0);
    setStep("when");
  };

  /**
   * Put it on the day. One request for an activity or a todo; two for text,
   * which becomes a todo and is placed in the same breath - so what was typed
   * is on the record as a thing that was done, not only as a block.
   */
  const place = (what: Subject, length: number, at: number) => {
    if (busy) return;
    const endsAt = at + length * 60_000;
    const request =
      what.kind === "activity"
        ? api.placeSlot(what.id, at, endsAt)
        : what.kind === "todo"
          ? api.placeTodo(what.id, at, endsAt)
          : api
              .createTodo({ title: what.title, minutes: length })
              .then((todo) => api.placeTodo(todo.id, at, endsAt));
    setBusy(true);
    request
      .then(() => {
        notify(`${what.title} · ${clockIn(at, tz)}`);
        onClose();
      })
      .catch((cause: unknown) =>
        notify(
          (cause instanceof ApiError ? cause.detail : undefined) ??
            `Couldn't put ${what.title} there.`,
        ),
      )
      .finally(() => {
        setBusy(false);
        reloadPlan();
        void reloadTodos();
      });
  };

  /** ⌘1–5: the chip, at the next mark that takes it, no second keystroke. */
  const drop = (activity: ActivityResponse) => {
    const at = fitsAt(activity.sessionMinutes, today, now);
    if (at === null) return notify(`No gap today for ${activity.name}.`);
    place(
      {
        kind: "activity",
        id: activity.id,
        title: activity.name,
        minutes: activity.sessionMinutes,
      },
      activity.sessionMinutes,
      at,
    );
  };

  const keep = (addonId: string, key: string) => {
    if (!subject) return;
    const sent = dispatchQuickAdd(addonId, {
      key,
      title: subject.title,
      minutes,
    });
    notify(sent ? "Kept as a todo" : "That addon isn't running.");
    if (sent) onClose();
  };

  const run = (row: Suggestion) => {
    if (!subject) return;
    if (row.action === "place" && row.at !== null)
      return place(subject, minutes, row.at);
    if (row.action === "time") return setStep("time");
    if (typeof row.action === "object")
      keep(row.action.addonId, row.action.key);
  };

  const placeAtPicked = () => {
    if (!subject) return;
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    if (!year || !month || !day || hour === undefined || minute === undefined)
      return;
    place(
      subject,
      minutes,
      instantFromLocal({ year, month, day, hour, minute }, tz).instant,
    );
  };

  const onKey = (event: React.KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;

    if (key === "Escape") {
      event.preventDefault();
      if (step === "search") onClose();
      else setStep(step === "time" ? "when" : "search");
      return;
    }

    if (step === "search") {
      const digit = /^[1-5]$/.test(key) ? Number(key) - 1 : -1;
      if (mod && digit >= 0 && chips[digit]) {
        event.preventDefault();
        return drop(chips[digit]);
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        const n = results.length;
        if (n > 0)
          setHighlight((h) => (h + (key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        const pick = results[highlight] ?? results[0];
        if (pick) choose(pick);
      }
      return;
    }

    if (step === "when") {
      if (key === "Tab") {
        event.preventDefault();
        const idx = durations.indexOf(minutes);
        const next = durations[(idx + 1) % durations.length];
        if (next !== undefined) setMinutes(next);
        return;
      }
      if (mod && key.toLowerCase() === "t") {
        event.preventDefault();
        return setStep("time");
      }
      if (event.altKey && key === "Enter") {
        event.preventDefault();
        const first = keepRows[0];
        if (first && typeof first.action === "object")
          keep(first.action.addonId, first.action.key);
        return;
      }
      const digit = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
      if (!mod && digit >= 0 && rows[digit]) {
        event.preventDefault();
        return run(rows[digit]);
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        const n = rows.length;
        if (n > 0)
          setHighlight((h) => (h + (key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        const row = rows[highlight] ?? rows[0];
        if (row) run(row);
      }
      return;
    }

    if (step === "time" && key === "Enter") {
      event.preventDefault();
      placeAtPicked();
    }
  };

  const todoMeta = (t: Subject): string => {
    const at = fitsAt(t.minutes, today, now);
    return `${t.minutes} min · ${at === null ? "no gap today" : `fits at ${clockIn(at, tz)}`}`;
  };

  return (
    <div className="wr-overlay wr-palette-overlay">
      <button
        type="button"
        className="wr-overlay-back"
        aria-label="Close quick add"
        onClick={onClose}
      />
      {/* The sheet takes the keys itself so a row can be picked with nothing
          focused inside it; the field is focused in the search step. */}
      <div
        ref={root}
        className="wr-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Quick add"
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <div className="wr-palette-head">
          <span className="wr-palette-dot" aria-hidden="true" />
          {step === "search" ? (
            <input
              ref={input}
              className="wr-palette-input"
              placeholder="Add a slot, or a todo"
              aria-label="What to add"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setHighlight(0);
              }}
            />
          ) : (
            <div className="wr-palette-input">{subject?.title}</div>
          )}
          <Keycap>esc</Keycap>
        </div>

        <div className="wr-palette-body">
          {step === "search" && !text.trim() ? (
            <>
              {chips.length > 0 ? (
                <>
                  <div className="wr-palette-kicker">
                    <span>Drop one now</span>
                    <span>⌘1–5 places it at the next mark</span>
                  </div>
                  <div className="wr-palette-chips">
                    {chips.map((a, i) => (
                      <button
                        key={a.id}
                        type="button"
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
                        <span
                          aria-hidden="true"
                          className={`wr-palette-chip-dot${a.kind === "focus" ? " wr-palette-chip-dot-focus" : ""}`}
                        />
                        {a.name}
                        <span className="wr-palette-chip-meta">
                          {a.sessionMinutes}
                        </span>
                        <Keycap>{i + 1}</Keycap>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {results.length > 0 ? (
                <div className="wr-palette-kicker" style={{ marginTop: 10 }}>
                  <span>Waiting in your todos</span>
                </div>
              ) : null}
            </>
          ) : null}

          {step === "search"
            ? results.map((r, i) => (
                <button
                  key={r.kind === "text" ? "text" : `${r.kind}/${r.id}`}
                  type="button"
                  className={`wr-palette-row${i === highlight ? " wr-palette-row-on" : ""}${r.kind === "text" ? " wr-palette-row-dashed" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(r)}
                >
                  <span className="wr-palette-text">
                    <span className="wr-palette-title">
                      {r.kind === "text" ? `“${r.title}”` : r.title}
                    </span>
                    <span className="wr-palette-note">
                      {r.kind === "activity"
                        ? `${r.minutes} min · activity`
                        : r.kind === "todo"
                          ? todoMeta(r)
                          : "New - say when, or keep it as a todo"}
                    </span>
                  </span>
                  <Keycap tone={i === highlight ? "accent" : "neutral"}>
                    ↵
                  </Keycap>
                </button>
              ))
            : null}

          {step === "when" ? (
            <>
              <div className="wr-palette-pills">
                {durations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`wr-palette-pill${d === minutes ? " wr-palette-pill-on" : ""}`}
                    onClick={() => setMinutes(d)}
                  >
                    {d} min
                  </button>
                ))}
                <span className="wr-palette-hint">Tab to change</span>
              </div>
              {rows.length === 1 && today ? (
                <p className="wr-palette-empty">
                  Nothing on today or tomorrow takes {minutes} minutes.
                </p>
              ) : null}
              {rows.map((row, i) => (
                <button
                  key={row.key}
                  type="button"
                  className={`wr-palette-row${i === highlight ? " wr-palette-row-on" : ""}${row.dashed ? " wr-palette-row-dashed" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => run(row)}
                  disabled={busy}
                >
                  <span className="wr-palette-when">{row.when}</span>
                  <span className="wr-palette-text">
                    <span className="wr-palette-title">{row.title}</span>
                    <span className="wr-palette-note">{row.note}</span>
                  </span>
                  <Keycap tone={i === highlight ? "accent" : "neutral"}>
                    {row.action === "time"
                      ? "⌘T"
                      : typeof row.action === "object"
                        ? "⌥↵"
                        : i === highlight
                          ? "↵"
                          : String(i + 1)}
                  </Keycap>
                </button>
              ))}
            </>
          ) : null}

          {step === "time" ? (
            <>
              <div className="wr-palette-kicker">
                <span>Day and time</span>
                <span>
                  {minutes} min · {tz}
                </span>
              </div>
              <div className="wr-palette-time">
                <input
                  type="date"
                  aria-label="Day"
                  value={date}
                  min={isoOf(todayOf())}
                  onChange={(event) => setDate(event.target.value)}
                />
                <input
                  type="time"
                  aria-label="Time"
                  step={300}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
                <button
                  type="button"
                  className="wr-palette-pill wr-palette-pill-on"
                  onClick={placeAtPicked}
                  disabled={busy}
                >
                  Place ↵
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="wr-palette-foot">
          {step === "search" ? (
            <>
              <span>
                <Keycap>↵</Keycap> choose
              </span>
              <span>
                <Keycap>⌘1–5</Keycap> drop now
              </span>
              <span className="wr-palette-hint">
                Type to search activities and todos
              </span>
            </>
          ) : step === "when" ? (
            <>
              <span>
                <Keycap>↵</Keycap> place
              </span>
              {keepRows.length > 0 ? (
                <span>
                  <Keycap>⌥↵</Keycap> keep as todo
                </span>
              ) : null}
              <span>
                <Keycap>⌘T</Keycap> pick a time
              </span>
              <span className="wr-palette-hint">
                <Keycap>esc</Keycap> back
              </span>
            </>
          ) : (
            <>
              <span>
                <Keycap>↵</Keycap> place
              </span>
              <span className="wr-palette-hint">
                <Keycap>esc</Keycap> back
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
