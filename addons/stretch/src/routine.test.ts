import { describe, expect, it } from "vitest";
import {
  advance,
  clock,
  leftOn,
  markup,
  onLastStep,
  ROUTINES,
  type Step,
  startAt,
  stepsFor,
} from "./routine";

const THEME = {
  text: "#2e2b25",
  muted: "rgba(0,0,0,.7)",
  hairline: "rgba(0,0,0,.1)",
  fontBody: "system-ui",
  fontHeading: "Georgia",
};

describe("stepsFor", () => {
  it("returns the routine that was asked for", () => {
    expect(stepsFor("Back & hips")).toBe(ROUTINES["Back & hips"]);
  });

  it("falls back rather than opening an empty session", () => {
    // A routine a newer version added, a config edited by hand, or nothing
    // stored at all. All three are the same answer.
    for (const bad of [undefined, null, "", "Ankles", 7, {}]) {
      expect(stepsFor(bad)).toBe(ROUTINES["Shoulders & neck"]);
    }
  });

  it("has no empty routine, so the session always has a first step", () => {
    for (const steps of Object.values(ROUTINES)) {
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.text.length).toBeGreaterThan(0);
        expect(step.seconds).toBeGreaterThan(0);
      }
    }
  });

  it("offers exactly what the manifest says it offers", () => {
    // The schema's options and this table are two lists of the same thing, in
    // two files, and a routine the form can pick but the bundle does not have
    // is a session that silently runs the wrong stretch.
    expect(Object.keys(ROUTINES).sort()).toEqual(
      ["Back & hips", "Shoulders & neck", "Wrists & eyes"].sort(),
    );
  });
});

describe("clock", () => {
  it("pads the seconds", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(5)).toBe("0:05");
  });
});

describe("markup", () => {
  it("draws on a transparent ground", () => {
    expect(markup(ROUTINES["Back & hips"] as never, THEME)).toContain(
      "background: transparent",
    );
  });

  it("uses the host's theme rather than a fixed colour", () => {
    // This activity type has no `ground`, so it sits on the app's own page
    // surface - which is near-black in the dark theme. A hard-coded ink here
    // is invisible in exactly one of the two themes.
    expect(markup(ROUTINES["Back & hips"] as never, THEME)).toContain(
      THEME.text,
    );
  });

  it("draws one pip per step", () => {
    const steps = ROUTINES["Wrists & eyes"] as never as unknown[];
    const html = markup(steps as never, THEME);
    expect(html.split('class="pip"').length - 1).toBe(steps.length);
  });
});

describe("walking the routine", () => {
  const steps = ROUTINES["Wrists & eyes"] as readonly Step[];
  const AT = 1_700_000_000_000;

  it("starts on the first step, timed from now", () => {
    const at = startAt(steps, AT);
    expect(at).toEqual({
      index: 0,
      endsAt: AT + (steps[0] as Step).seconds * 1_000,
      finished: false,
    });
  });

  it("times each step from when it began, not from the routine's start", () => {
    // A step the user sat through and one they skipped both start their own
    // clock. Timing from the routine's start would make every step after a
    // skipped one shorter than it says.
    const later = AT + 12_345;
    const second = advance(steps, startAt(steps, AT), later);
    expect(second.endsAt).toBe(later + (steps[1] as Step).seconds * 1_000);
  });

  /**
   * The button is gone on the last step, not relabelled.
   *
   * This addon's button means "move the routine on", and on the last step
   * there is nothing to move on to - what is left is ending the *slot*, which
   * is the host's Done early just below the frame. It could not end the slot
   * itself whatever the label said: it holds `ui:session` and nothing else.
   */
  it("offers a next step until there is not one", () => {
    let at = startAt(steps, AT);
    for (let i = 0; i < steps.length - 1; i += 1) {
      expect(onLastStep(steps, at)).toBe(false);
      at = advance(steps, at, AT);
    }
    expect(at.index).toBe(steps.length - 1);
    expect(onLastStep(steps, at)).toBe(true);
  });

  it("finishes past the last step rather than running off the end", () => {
    let at = startAt(steps, AT);
    for (let i = 0; i < steps.length; i += 1) at = advance(steps, at, AT);

    expect(at.finished).toBe(true);
    // Held at the last real step, so nothing reads `steps[4]` of a four-step
    // routine while the finished message is up.
    expect(at.index).toBe(steps.length - 1);
    // And it stays finished. The 250ms tick keeps calling in.
    expect(advance(steps, at, AT + 9_999)).toEqual(at);
    expect(onLastStep(steps, at)).toBe(false);
  });

  it("counts down without going negative", () => {
    const at = startAt(steps, AT);
    expect(leftOn(at, AT)).toBe((steps[0] as Step).seconds);
    expect(leftOn(at, AT + 999_999)).toBe(0);
  });

  it("hides the button with CSS rather than only the attribute", () => {
    // `hidden` is not honoured on an element the stylesheet gives a display
    // value to, and this one is an inline-flex button.
    expect(markup(steps, THEME)).toContain(".next[hidden] { display: none; }");
  });
});
