import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { eyeRest } from "./activities/eye-rest";
import {
  ActivityModuleFields,
  type ModuleDraft,
} from "./activity-module-fields";

/**
 * What the sheet says an activity will do.
 *
 * The switch is the whole choice, so the sentence beside it has to describe
 * both sides of it at once. It used to describe only the state the switch was
 * already in, which told you what you had just done rather than what you were
 * about to choose - and left the off state undescribed until you turned it
 * off to find out.
 */

const draft = (over: Partial<ModuleDraft> = {}): ModuleDraft => ({
  presetKey: "eye_rest",
  sessionEnabled: true,
  startPolicy: "auto",
  configJson: null,
  ...over,
});

const show = (value: ModuleDraft) =>
  render(<ActivityModuleFields value={value} onChange={vi.fn()} />);

test("says what happens both ways, whichever way the switch is set", () => {
  for (const sessionEnabled of [true, false]) {
    const { container, unmount } = show(draft({ sessionEnabled }));
    const hint = container.querySelector(".wr-activity-hint")?.textContent;
    expect(hint).toContain(eyeRest.blurb);
    expect(hint).toContain("just a slot on your day");
    unmount();
  }
});

// A custom activity is a plain timed slot. A switch that could only ever say
// "off" would be a worse answer than saying nothing.
test("a custom activity is offered no behaviour at all", () => {
  const { container } = show(draft({ presetKey: null }));
  expect(container.innerHTML).toBe("");
});

test("the switch carries a label anyone can see, not only read out", () => {
  show(draft());
  expect(screen.getByText("Eye rest session")).toBeTruthy();
});

/**
 * The link only stands where it is needed.
 *
 * `prompt` is the one policy that cannot work without the permission, so it
 * is the one that offers the way to grant it. Offering it under the other two
 * would be asking for something they do not use.
 */
test("only the policy that needs notifications links to their settings", async () => {
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
  const onChange = vi.fn();
  render(<ActivityModuleFields value={draft()} onChange={onChange} />);

  await userEvent.click(screen.getByRole("button", { name: "Ask me" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ startPolicy: "prompt" }),
  );
});
