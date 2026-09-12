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

/**
 * The row's second line: how long, and where it would land today.
 *
 * A missing length is left unsaid rather than spelled "no length". It is the
 * ordinary case for something typed in a hurry, it is not news, and in a
 * 108px column that phrase was what pushed the line onto a second row.
 */
export function metaOf(todo: Todo, timeZone: string): string {
  const fit =
    todo.fitsAt === null
      ? "no gap today"
      : `fits ${clockIn(todo.fitsAt, timeZone)}`;
  return todo.minutes === null ? fit : `${todo.minutes} min · ${fit}`;
}

/**
 * The slot button's accessible name, or null when there is nowhere to put it.
 *
 * A name, not a label: the button draws an icon. The time it would land at is
 * already on the row's second line, and printing it twice is what forced the
 * button wide enough that it could only appear on hover.
 */
export const slotLabelOf = (todo: Todo, timeZone: string): string | null =>
  todo.fitsAt === null ? null : `Slot ${clockIn(todo.fitsAt, timeZone)}`;

/**
 * The kit's icons, drawn by hand because a frame cannot import them.
 *
 * Tabler's own paths at Tabler's own 24-box, so these are the same glyphs the
 * app uses rather than a second set that merely looks similar. Stroke 2.4 and
 * `currentColor` to match `packages/design/src/icons.tsx`.
 */
const icon = (paths: readonly string[]): string =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    >${paths.map((d) => `<path d="${d}"></path>`).join("")}</svg>`;

const CALENDAR_PLUS = icon([
  "M12.5 21h-6.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v5",
  "M16 3v4",
  "M8 3v4",
  "M4 11h16",
  "M16 19h6",
  "M19 16v6",
]);

const CROSS = icon(["M18 6l-12 12", "M6 6l12 12"]);

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
  /* The row answers the pointer with its ground, the way every other row in
     the app does - there is nothing left to reveal. */
  .row:hover { border-color: ${theme.muted}; }
  .row.done { opacity: .55; }
  .row.done .title { text-decoration: line-through; }
  .tick {
    width: 16px; height: 16px; flex: none; border-radius: 999px; cursor: pointer;
    border: 1.5px solid ${theme.muted}; background: transparent; padding: 0;
  }
  .tick:hover { border-color: ${theme.accent}; }
  .text { flex: 1; min-width: 0; }
  .title { font: 600 12.5px/1.3 ${theme.fontBody}; overflow-wrap: anywhere; }
  /* One line, always. The row's height must not depend on how long a todo's
     second line happens to be. */
  .meta {
    font: 400 11px/1.3 ${theme.fontBody}; color: ${theme.muted};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  /* Always there, never revealed.
     These used to appear on hover while the meta line was hidden to make room,
     so pointing at a row changed its height, the card re-measured, and the
     whole rail below it moved - on a list, every row you pass over. Nothing
     here changes size any more: hover only changes colour, which is what the
     rest of the app does too. */
  .acts { display: flex; gap: 2px; flex: none; }
  .act {
    width: 22px; height: 22px; flex: none; padding: 0; border: 0; cursor: pointer;
    border-radius: 999px; background: transparent; color: ${theme.muted};
    display: flex; align-items: center; justify-content: center;
  }
  .act:hover:not(:disabled) { background: ${theme.track}; color: ${theme.text}; }
  /* Offered but not available: today has no gap this would fit in, which the
     row's second line already says. Kept in place so a list of rows has one
     column of buttons rather than a ragged edge. */
  .act:disabled { cursor: default; opacity: .35; }
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
    const slot = doc.createElement("button");
    slot.type = "button";
    slot.className = "act";
    // The glyphs are ours, not the user's - `markup` writes the same constants
    // into the stylesheet above. Everything the user typed still goes in as
    // text, which is the rule this file is built around.
    slot.innerHTML = CALENDAR_PLUS;
    slot.disabled = slotLabel === null;
    slot.title = slotLabel ?? "No gap for it today";
    slot.setAttribute("aria-label", `${slot.title}: ${todo.title}`);
    if (slotLabel) slot.addEventListener("click", () => on.place(todo.id));

    const drop = doc.createElement("button");
    drop.type = "button";
    drop.className = "act";
    drop.innerHTML = CROSS;
    drop.title = "Remove";
    drop.setAttribute("aria-label", `Remove: ${todo.title}`);
    drop.addEventListener("click", () => on.drop(todo.id));

    acts.append(slot, drop);

    row.append(tick, text, acts);
    list.append(row);
  }
}
