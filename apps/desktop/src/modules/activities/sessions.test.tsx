import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { testAddon } from "../../addons/fixtures";
import { seedAddons } from "../../addons/installed";
import type { TodaySlot } from "../../lib/api";
import { moduleFor } from "./index";

/**
 * A session reaches its two ways out, whoever wrote it.
 *
 * Not a test of what a session looks like - that is the gallery's job, and a
 * snapshot of a stretch step would fail on every retune. What matters is that
 * "finished" and "gave up" stay two distinct answers and both stay reachable:
 * a session with no way to say you did it records nothing, and one where
 * stopping counts as finishing puts a stretch nobody did into this week's
 * numbers.
 *
 * ## Why this is now one test and not four
 *
 * It used to run over the four built-in sessions. There are none: every
 * session is an addon, drawn inside a sandboxed frame, and the frame around it
 * is the host's. So there is exactly one piece of code that puts Done and Stop
 * on the screen, and this is the test of it - which is a stronger guarantee
 * than the old one, because it now holds for sessions nobody here has written
 * yet.
 *
 * The addon's own drawing is not exercised here and cannot be: it is inside an
 * iframe with an opaque origin, which jsdom will not run and which is the
 * entire point. What each addon draws is tested in the addon's own package.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

const slot = (over: Partial<TodaySlot> = {}): TodaySlot => ({
  id: "s1",
  title: "Morning workout",
  kind: "recovery",
  startsAt: AT,
  // Well into the future, so nothing ends itself mid-test.
  endsAt: AT + 60 * 60_000,
  status: "started",
  isLocked: false,
  conflictEventId: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ now: AT, shouldAdvanceTime: true });
  seedAddons([testAddon()]);
});

const show = (over: Partial<TodaySlot> = {}) => {
  const module = moduleFor("acme.fitness/workout");
  const Session = module?.Session;
  if (!Session) throw new Error("the fixture addon has no session");

  const onDone = vi.fn();
  const onSkip = vi.fn();
  render(
    <Session
      slot={slot(over)}
      config={module.defaults.config}
      onDone={onDone}
      onSkip={onSkip}
    />,
  );
  return { onDone, onSkip };
};

test("stopping is a skip, never a completion", async () => {
  const { onDone, onSkip } = show();

  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onSkip).toHaveBeenCalledOnce();
  expect(onDone).not.toHaveBeenCalled();
});

test("finishing is a completion, never a skip", async () => {
  const { onDone, onSkip } = show();

  await userEvent.click(screen.getByRole("button", { name: "Done early" }));
  expect(onDone).toHaveBeenCalledOnce();
  expect(onSkip).not.toHaveBeenCalled();
});

/**
 * The buttons belong to the host, not to the addon.
 *
 * This is the invariant worth stating out loud. A full-window takeover whose
 * exit button was drawn by the addon would be an exit button the addon could
 * fake, restyle or refuse to honour - and a session is exactly the moment a
 * user has to be able to leave. Both controls are outside the frame, in the
 * app's own DOM, which is why they are reachable from this test at all.
 */
test("both ways out are the host's own buttons, outside the addon's frame", () => {
  show();

  const frame = document.querySelector("iframe");
  expect(frame).toBeTruthy();
  for (const name of ["Done early", "Stop"]) {
    const button = screen.getByRole("button", { name });
    expect(frame?.contains(button)).toBe(false);
  }
});

test("the session names the block, not the activity type", () => {
  // Somebody who called their focus block "Thesis" is looking at a session
  // about the thesis. Telling them it is a "Workout" tells them something they
  // already decided not to call it.
  show({ title: "Thesis" });
  expect(screen.getByRole("dialog", { name: "Thesis" })).toBeTruthy();
});

test("the addon is given a canvas it cannot grow past", () => {
  show();
  const frame = document.querySelector("iframe");
  // The manifest declares no canvas, so it gets the default. What matters is
  // that a size is imposed at all: an iframe has no intrinsic height, and an
  // addon that could set its own could cover the buttons above.
  expect(frame?.style.width).toBe("360px");
  expect(frame?.style.height).toBe("400px");
  // A flex item shrinks by default, and SessionFrame is a flex column. On a
  // short window that silently cut the addon's lower half off.
  expect(frame?.style.flexShrink).toBe("0");
});

test("the frame is sandboxed with no same-origin access", () => {
  show();
  const frame = document.querySelector("iframe");
  // The single most important attribute in the app. Without `allow-scripts`
  // no addon runs; with `allow-same-origin` every addon becomes the app, and
  // the session token in localStorage is a thirty-day bearer for the API.
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
});
