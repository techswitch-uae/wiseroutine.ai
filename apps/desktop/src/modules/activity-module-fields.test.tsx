import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { testAddon } from "../addons/fixtures";
import { seedAddons } from "../addons/installed";
import {
  ActivityModuleFields,
  type ModuleDraft,
} from "./activity-module-fields";

/**
 * What the sheet says an activity will do, and what it lets you configure.
 *
 * Two jobs, and the second one is new. The switch is the whole choice, so the
 * sentence beside it has to describe both sides at once - it used to describe
 * only the state the switch was already in, which told you what you had just
 * done rather than what you were about to choose.
 *
 * The settings below the switch are drawn from the addon's declared schema,
 * with the app's own fields. That is the part worth testing hardest: the host
 * reads and writes an addon's configuration *without executing a line of it*,
 * so a schema that renders nothing, or renders a value it cannot store, is a
 * setting the user can see and not keep.
 */

const draft = (over: Partial<ModuleDraft> = {}): ModuleDraft => ({
  presetKey: "acme.fitness/workout",
  sessionEnabled: true,
  startPolicy: "auto",
  configJson: null,
  ...over,
});

const show = (value: ModuleDraft, onChange = vi.fn()) => {
  render(<ActivityModuleFields value={value} onChange={onChange} />);
  return onChange;
};

beforeEach(() => seedAddons([testAddon()]));

test("says what happens both ways, whichever way the switch is set", () => {
  for (const sessionEnabled of [true, false]) {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ActivityModuleFields
        value={draft({ sessionEnabled })}
        onChange={onChange}
      />,
    );
    const hint = container.querySelector(".wr-activity-hint")?.textContent;
    expect(hint).toContain("counts you through the set");
    expect(hint).toContain("just a slot on your day");
    unmount();
  }
});

// A custom activity is a plain timed slot. A switch that could only ever say
// "off" would be a worse answer than saying nothing.
test("a custom activity is offered no behaviour at all", () => {
  const { container } = render(
    <ActivityModuleFields
      value={draft({ presetKey: null })}
      onChange={vi.fn()}
    />,
  );
  expect(container.innerHTML).toBe("");
});

/**
 * The same answer for an addon that has gone away.
 *
 * Switched off, removed, or withdrawn from the registry - the sheet cannot
 * draw settings for a schema it no longer has, and must not pretend to. The
 * activity keeps its `presetKey`, so switching the addon back on brings the
 * whole form back with it.
 */
test("an activity whose addon is switched off shows no settings", () => {
  seedAddons([]);
  const { container } = render(
    <ActivityModuleFields value={draft()} onChange={vi.fn()} />,
  );
  expect(container.innerHTML).toBe("");
});

test("the switch carries a label anyone can see, not only read out", () => {
  show(draft());
  expect(screen.getByText("Workout session")).toBeTruthy();
});

test("draws a field for every kind of setting the schema declares", () => {
  show(draft());
  // One of each: the three types the manifest format allows. A type with no
  // field drawn for it is a setting the addon author declared and the user
  // cannot reach.
  expect(screen.getByLabelText("Level")).toBeTruthy();
  expect(screen.getByLabelText("Reps")).toBeTruthy();
  expect(screen.getByLabelText("Notes")).toBeTruthy();
});

test("shows the addon's placeholder without storing it as a value", () => {
  show(draft());
  const notes = screen.getByLabelText("Notes") as HTMLInputElement;
  expect(notes.placeholder).toBe("https://example.test/notes");
  expect(notes.value).toBe("");
});

test("writes a changed setting back as the stored JSON", async () => {
  const onChange = show(draft());

  await userEvent.selectOptions(screen.getByLabelText("Level"), "hard");

  const next = onChange.mock.calls.at(-1)?.[0] as ModuleDraft;
  expect(JSON.parse(next.configJson ?? "{}")).toEqual({
    level: "hard",
    reps: 10,
    noteUrl: "",
  });
});

test("holds a number setting inside the range the schema allows", async () => {
  const onChange = show(draft());
  const reps = screen.getByLabelText("Reps") as HTMLInputElement;

  // Typed, not stepped. The input's own min and max only guard the arrows,
  // and a value outside the range would be reset by `parseConfig` on the next
  // read - so the field would appear to forget what was typed into it.
  await userEvent.clear(reps);
  await userEvent.type(reps, "999");

  const next = onChange.mock.calls.at(-1)?.[0] as ModuleDraft;
  expect(JSON.parse(next.configJson ?? "{}").reps).toBe(50);
});

test("settings disappear when the session is switched off", () => {
  // Nothing to configure about a session that does not run. The stored config
  // is kept, so switching it back on restores the form as it was.
  render(
    <ActivityModuleFields
      value={draft({ sessionEnabled: false })}
      onChange={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("Level")).toBeNull();
});

/**
 * The link only stands where it is needed.
 *
 * `prompt` is the one policy that cannot work without the permission, so it
 * is the one that offers the way to grant it. Offering it under the other two
 * would be asking for something they do not use.
 */
test("only the policy that needs notifications links to their settings", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ActivityModuleFields
      value={draft({ startPolicy: "prompt" })}
      onChange={onChange}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "open Notification settings" }),
  ).toBeTruthy();

  rerender(
    <ActivityModuleFields
      value={draft({ startPolicy: "manual" })}
      onChange={onChange}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "open Notification settings" }),
  ).toBeNull();
});

test("the three start policies are one control, not a menu", async () => {
  const onChange = show(draft());

  await userEvent.click(screen.getByRole("button", { name: "Ask me" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ startPolicy: "prompt" }),
  );
});
