/**
 * The entry point.
 *
 * A widget, and the first addon that writes through the host: `todos.*` is
 * the app's own list, not a private store, so what this card adds is what
 * Quick add offers and what the day can take. The card never holds the list
 * - it asks for it on every change the host announces, and the host
 * announces every write, this addon's own included.
 *
 * Two ways in besides the rail: `onQuickAdd`, which is the dialog handing
 * over what was typed, and the field at the bottom of the card. Both end in
 * `todos.add`, so there is one place a todo is made.
 */

import { AddonError, connect } from "@wiseroutine/addon-sdk";
import { heightOf, markup, parseAdd, render } from "./card";

async function main(): Promise<void> {
  const wr = await connect();
  if (wr.role.kind !== "widget") return;

  document.body.innerHTML = markup(wr.theme);
  const list = document.querySelector<HTMLElement>(".list");
  const form = document.querySelector<HTMLFormElement>(".add");
  const field = document.querySelector<HTMLInputElement>(".field");
  const note = document.querySelector<HTMLElement>(".note");
  if (!list || !form || !field || !note) return;

  let timeZone = "UTC";
  let count = 0;
  let sent = 0;

  const say = (text: string) => {
    note.textContent = text;
    note.hidden = text === "";
  };

  /** A refusal is written to be read - see `AddonError`. Anything else is
   *  ours, and the user gets the one sentence that is true either way. */
  const tried = (work: Promise<unknown>, failed: string) =>
    work.catch((cause: unknown) =>
      say(cause instanceof AddonError ? cause.message : failed),
    );

  /** Tell the host how tall to draw the card - see `day-so-far` for why this
   *  is measured, and re-measured, rather than calculated. */
  const sizeUp = async () => {
    const height = heightOf(document);
    if (height === sent) return;
    sent = height;
    await wr.card({
      eyebrow: count > 0 ? `Todos · ${count}` : "Todos",
      height,
    });
  };

  const draw = async () => {
    const [todos, day] = await Promise.all([
      wr.todos.list(),
      wr.day().catch(() => null),
    ]);
    if (day) timeZone = day.timeZone;
    count = todos.length;
    render(list, todos, timeZone, {
      done: (id) => tried(wr.todos.set(id, "done"), "Couldn't tick it."),
      drop: (id) => tried(wr.todos.set(id, "dropped"), "Couldn't drop it."),
      place: (id) => tried(wr.todos.place(id), "Couldn't put it on the day."),
    });
    if (todos.length === 0) say("Nothing waiting. Type one below, or ⌘K.");
    else say("");
    // Forced, because the eyebrow may have changed while the height did not.
    sent = 0;
    await sizeUp();
  };

  const redraw = () => void draw().catch(() => undefined);

  /**
   * The field. ↵ keeps it here; ⌘↵ adds it and puts it on the day in the
   * same breath, at the first gap that takes it. `T` anywhere in the card
   * brings the field into focus, which is as far as a frame's keyboard
   * reaches - the host's own keys stop at the frame's edge.
   */
  const add = async (andPlace: boolean) => {
    const parsed = parseAdd(field.value);
    if (!parsed) return;
    field.value = "";
    const todo = await wr.todos.add(parsed);
    if (andPlace) await wr.todos.place(todo.id);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void tried(add(false), "Couldn't add it.");
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void tried(add(true), "Couldn't put it on the day.");
    }
    if (event.key === "Escape") field.value = "";
  });
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "t" && document.activeElement !== field) {
      event.preventDefault();
      field.focus();
    }
  });

  wr.onQuickAdd((request) => {
    void tried(
      wr.todos.add({ title: request.title, minutes: request.minutes }),
      "Couldn't keep it.",
    );
  });
  wr.onTodosChange(redraw);
  wr.onDayChange(redraw);
  new ResizeObserver(() => void sizeUp().catch(() => undefined)).observe(
    document.body,
  );

  await draw();
}

void main().catch(() => {
  // Silent, for the reason day-so-far gives: a card nobody asked for that
  // fails is better absent than explaining itself in the rail all day.
});
