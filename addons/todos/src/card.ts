import type { AddonTheme, Todo } from "@wiseroutine/addon-sdk";

/**
 * What the card draws.
 *
 * The same split as `day-so-far`: a markup string for the shell, written
 * once, and DOM built by hand for the rows, which carry text the user typed
 * and must never go through `innerHTML`.
 */

/** How tall the card needs to be. Measured, not calculated - see day-so-far. */
export const heightOf = (root: Document): number =>
  Math.ceil(root.body.getBoundingClientRect().height);

const clockIn = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(at);

/** The row's second line: how long, and where it would land today. */
export function metaOf(todo: Todo, timeZone: string): string {
  const length = todo.minutes === null ? "no length" : `${todo.minutes} min`;
  const fit =
    todo.fitsAt === null
      ? "no gap today"
      : `fits ${clockIn(todo.fitsAt, timeZone)}`;
  return `${length} · ${fit}`;
}

/** The "Slot" button's label, or null when there is nowhere to slot it. */
export const slotLabelOf = (todo: Todo, timeZone: string): string | null =>
  todo.fitsAt === null ? null : `Slot ${clockIn(todo.fitsAt, timeZone)}`;

/**
 * What was typed in the add row, read as a todo.
 *
 * A trailing length - "Reply to Anders 20m", "Physio 20 min" - is taken off
 * the title and kept as minutes, so the one field does both without a second
 * control. Anything else is the title as written.
 */
export function parseAdd(
  text: string,
): { title: string; minutes: number | null } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(.*?)\s+(\d{1,3})\s*(?:m|min|mins|minutes)$/i.exec(trimmed);
  if (match?.[1] && match[2]) {
    return { title: match[1].trim(), minutes: Number(match[2]) };
  }
  return { title: trimmed, minutes: null };
}

export function markup(theme: AddonTheme): string {
  return `<style>
  html, body { margin: 0; background: transparent; }
  body {
    font-family: ${theme.fontBody}; color: ${theme.text};
    -webkit-font-smoothing: antialiased; display: flow-root;
  }
  .list { display: flex; flex-direction: column; gap: 6px; }
  .row {
    display: flex; align-items: center; gap: 10px; padding: 9px 11px;
    border-radius: 13px; border: 1px solid ${theme.hairline};
  }
  .row.done { opacity: .55; }
  .row.done .title { text-decoration: line-through; }
  .tick {
    width: 16px; height: 16px; flex: none; border-radius: 999px; cursor: pointer;
    border: 1.5px solid ${theme.muted}; background: transparent; padding: 0;
  }
  .tick:hover { border-color: ${theme.accent}; }
  .text { flex: 1; min-width: 0; }
  .title { font: 600 12.5px/1.3 ${theme.fontBody}; overflow-wrap: anywhere; }
  .meta { font: 400 11px/1.3 ${theme.fontBody}; color: ${theme.muted}; }
  .acts { display: none; gap: 5px; flex: none; }
  .row:hover .acts, .row:focus-within .acts { display: flex; }
  .row:hover .meta { display: none; }
  .slot {
    padding: 5px 10px; border-radius: 999px; border: 0; cursor: pointer;
    background: ${theme.accent}; color: #fff; font: 600 10.5px ${theme.fontBody};
  }
  .drop {
    width: 22px; height: 22px; border-radius: 999px; border: 0; cursor: pointer;
    background: ${theme.track}; color: ${theme.text}; font: 600 12px ${theme.fontBody};
  }
  .add {
    display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 9px 11px;
    border-radius: 13px; border: 1px dashed ${theme.muted};
  }
  .field {
    flex: 1; min-width: 0; border: 0; background: transparent; outline: none; padding: 0;
    font: 600 12.5px ${theme.fontBody}; color: ${theme.text};
  }
  .field::placeholder { color: ${theme.muted}; font-weight: 400; }
  .key {
    font: 600 10px ui-monospace, Menlo, monospace; padding: 2px 7px; border-radius: 999px;
    background: ${theme.track}; color: ${theme.muted};
  }
  .note { margin: 8px 0 0; font: 400 11.5px/1.4 ${theme.fontBody}; color: ${theme.muted}; }
</style>
<div class="list"></div>
<form class="add">
  <span class="key">+</span>
  <input class="field" placeholder="Add a todo" aria-label="Add a todo">
  <span class="key">T</span>
</form>
<p class="note"></p>`;
}

export interface RowActions {
  done: (id: string) => void;
  drop: (id: string) => void;
  place: (id: string) => void;
}

/** Rebuild the list. Text goes in as text; nothing typed reaches `innerHTML`. */
export function render(
  list: HTMLElement,
  todos: readonly Todo[],
  timeZone: string,
  on: RowActions,
): void {
  const doc = list.ownerDocument;
  list.replaceChildren();

  for (const todo of todos) {
    const row = doc.createElement("div");
    row.className = "row";
    row.dataset.id = todo.id;

    const tick = doc.createElement("button");
    tick.type = "button";
    tick.className = "tick";
    tick.title = "Done";
    tick.setAttribute("aria-label", `Done: ${todo.title}`);
    tick.addEventListener("click", () => {
      row.classList.add("done");
      on.done(todo.id);
    });

    const text = doc.createElement("div");
    text.className = "text";
    const title = doc.createElement("div");
    title.className = "title";
    title.textContent = todo.title;
    const meta = doc.createElement("div");
    meta.className = "meta";
    meta.textContent = metaOf(todo, timeZone);
    text.append(title, meta);

    const acts = doc.createElement("div");
    acts.className = "acts";
    const slotLabel = slotLabelOf(todo, timeZone);
    if (slotLabel) {
      const slot = doc.createElement("button");
      slot.type = "button";
      slot.className = "slot";
      slot.textContent = slotLabel;
      slot.addEventListener("click", () => on.place(todo.id));
      acts.append(slot);
    }
    const drop = doc.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "×";
    drop.setAttribute("aria-label", `Remove: ${todo.title}`);
    drop.addEventListener("click", () => on.drop(todo.id));
    acts.append(drop);

    row.append(tick, text, acts);
    list.append(row);
  }
}
