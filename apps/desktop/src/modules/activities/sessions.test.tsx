import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TodaySlot } from "../../lib/api";
import { deepWork } from "./deep-work";
import { eyeRest } from "./eye-rest";
import { stretch } from "./stretch";

/**
 * Each session reaches its two ways out.
 *
 * Not a test of what a session looks like - that is the gallery's job, and a
 * snapshot of a stretch step would fail on every retune. What matters here
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
}[] = [eyeRest, stretch];

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

/**
 * The bug this exists to keep fixed: the countdown hung near its start and no
 * step ever ended.
 *
 * The overlay parses the stored config afresh on every render, so `config` is
 * a new object every second - which is what the re-render below stands in for.
 * The old step timer listed `config.steps` among its dependencies, so it was
 * torn down and restarted, from the top, on every tick.
 */
test("the countdown runs down across re-renders, and the step advances itself", () => {
  const Session = stretch.Session;
  if (!Session) throw new Error("no session");

  // A fresh object each call, exactly as the overlay hands one over.
  const config = () => ({
    steps: [
      { text: "one", seconds: 3 },
      { text: "two", seconds: 3 },
    ],
  });
  const props = { slot: slot(), onDone: vi.fn(), onSkip: vi.fn() };
  const { rerender } = render(<Session {...props} config={config()} />);

  expect(screen.getByText("0:03")).toBeTruthy();
  act(() => void vi.advanceTimersByTime(2_000));
  rerender(<Session {...props} config={config()} />);
  expect(screen.getByText("0:01")).toBeTruthy();
  expect(screen.getByText("Step 1 of 2")).toBeTruthy();

  act(() => void vi.advanceTimersByTime(1_000));
  expect(screen.getByText("Step 2 of 2")).toBeTruthy();
  expect(props.onDone).not.toHaveBeenCalled();

  // And the last step's own deadline finishes the session.
  act(() => void vi.advanceTimersByTime(3_000));
  expect(props.onDone).toHaveBeenCalledOnce();
});

describe("deep work", () => {
  /**
   * The block is already running by the time this screen exists.
   *
   * It used to open behind a "Play music & start" button, which made a
   * session that had begun look like one that had not - and asked for an
   * intention nobody had come here to write.
   */
  test("opens straight into the countdown, with nothing to fill in first", () => {
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

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByRole("button", { name: "Finish now" })).toBeTruthy();
  });

  test("plays the playlist in the block rather than only linking to it", () => {
    const Session = deepWork.Session;
    if (!Session) throw new Error("no session");

    render(
      <Session
        slot={slot()}
        config={{ musicUrl: "https://open.spotify.com/playlist/37i9dQZF1DX" }}
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    const player = screen.getByTitle("Music for this block");
    expect(player.getAttribute("src")).toBe(
      "https://open.spotify.com/embed/playlist/37i9dQZF1DX",
    );
    // Spotify's own troubleshooting page names this attribute as the
    // difference between full playback and thirty-second previews.
    expect(player.getAttribute("allow")).toContain("encrypted-media");
    // And the way out to the whole playlist, because in here nobody is
    // signed in.
    expect(
      screen.getByRole("button", { name: /Open in Spotify/ }),
    ).toBeTruthy();
  });

  // Apple Music, a radio stream, anything with no embed. The only honest
  // offer is the app that owns it.
  test("offers to open anything it cannot embed", () => {
    const Session = deepWork.Session;
    if (!Session) throw new Error("no session");

    render(
      <Session
        slot={slot()}
        config={{ musicUrl: "https://music.apple.com/playlist/x" }}
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.queryByTitle("Music for this block")).toBeNull();
    expect(screen.getByRole("button", { name: "Play music" })).toBeTruthy();
  });

  test("shows no player at all when no music was set", () => {
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
    expect(screen.queryByTitle("Music for this block")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play music" })).toBeNull();
  });
});
