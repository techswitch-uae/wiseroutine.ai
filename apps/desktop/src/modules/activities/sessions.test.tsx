import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TodaySlot } from "../../lib/api";
import { breathing } from "./breathing";
import { deepWork } from "./deep-work";
import { eyeRest } from "./eye-rest";
import { stretch } from "./stretch";

/**
 * Each session reaches its two ways out.
 *
 * Not a test of what a session looks like - that is the gallery's job, and a
 * snapshot of a breathing circle would fail on every retune. What matters here
 * is that "finished" and "gave up" stay two distinct answers and both are
 * actually reachable: a session with no way to say you did it records nothing,
 * and one where stopping counts as finishing puts a stretch nobody did into
 * this week's numbers.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);

const slot = (over: Partial<TodaySlot> = {}): TodaySlot => ({
  id: "s1",
  title: "Deep work",
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
});

/**
 * The three timed sessions, with their config types erased.
 *
 * `describe.each` over the modules as written would intersect their configs -
 * a case would have to satisfy `EyeRestConfig & BreathingConfig &
 * StretchConfig` at once. Each case supplies its own defaults, which is
 * exactly the pairing the intersection loses.
 */
const MODULES: readonly {
  name: string;
  key: string;
  // biome-ignore lint/suspicious/noExplicitAny: erased on purpose, see above
  Session?: React.FC<any>;
  // biome-ignore lint/suspicious/noExplicitAny: erased on purpose, see above
  defaults: { config: any };
}[] = [eyeRest, breathing, stretch];

describe.each(MODULES)("$name", (module) => {
  test("stopping is a skip, never a completion", async () => {
    const onDone = vi.fn();
    const onSkip = vi.fn();
    const Session = module.Session;
    if (!Session) throw new Error(`${module.key} has no session`);

    render(
      <Session
        slot={slot()}
        config={module.defaults.config}
        onDone={onDone}
        onSkip={onSkip}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  });

  test("names itself, so the window says what is running", () => {
    const Session = module.Session;
    if (!Session) throw new Error(`${module.key} has no session`);
    render(
      <Session
        slot={slot()}
        config={module.defaults.config}
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

test("eye rest can be finished early", async () => {
  const onDone = vi.fn();
  const Session = eyeRest.Session;
  if (!Session) throw new Error("no session");

  render(
    <Session
      slot={slot()}
      config={eyeRest.defaults.config}
      onDone={onDone}
      onSkip={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Done early" }));
  expect(onDone).toHaveBeenCalledOnce();
});

test("a stretch walks its steps, and only the last one finishes it", async () => {
  const onDone = vi.fn();
  const Session = stretch.Session;
  if (!Session) throw new Error("no session");

  render(
    <Session
      slot={slot()}
      config={stretch.defaults.config}
      onDone={onDone}
      onSkip={vi.fn()}
    />,
  );

  const steps = stretch.defaults.config.steps;
  expect(screen.getByText(`Step 1 of ${steps.length}`)).toBeTruthy();
  expect(screen.getByText(steps[0]?.text ?? "")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Next step" }));
  expect(screen.getByText(`Step 2 of ${steps.length}`)).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();

  // Through to the end. Only the final press means the routine happened.
  await userEvent.click(screen.getByRole("button", { name: "Next step" }));
  await userEvent.click(screen.getByRole("button", { name: "Next step" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  expect(onDone).toHaveBeenCalledOnce();
});

describe("deep work", () => {
  test("asks what the block is for before it starts the clock", async () => {
    const Session = deepWork.Session;
    if (!Session) throw new Error("no session");

    render(
      <Session
        slot={slot({ title: "Deep work" })}
        config={{ musicUrl: "" }}
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("What is this block for?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    // The intention field is gone and the countdown has taken its place: it is
    // a commitment made once, not a note to keep editing.
    expect(screen.queryByLabelText("What is this block for?")).toBeNull();
  });

  test("the intention written stays on screen for the whole block", async () => {
    const Session = deepWork.Session;
    if (!Session) throw new Error("no session");

    render(
      <Session
        slot={slot()}
        config={{ musicUrl: "" }}
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    await userEvent.type(
      screen.getByLabelText("What is this block for?"),
      "three tier headlines",
    );
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("three tier headlines")).toBeTruthy();
  });

  // The button says what the press will do. Someone who has set a playlist
  // should not have to guess that starting also plays it.
  test("says so when a press will also open music", () => {
    const Session = deepWork.Session;
    if (!Session) throw new Error("no session");

    render(
      <Session
        slot={slot()}
        config={{ musicUrl: "https://open.spotify.com/playlist/x" }}
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Play music & start" }),
    ).toBeTruthy();
  });
});
