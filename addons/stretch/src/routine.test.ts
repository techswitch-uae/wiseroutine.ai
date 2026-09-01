import { describe, expect, it } from "vitest";
import { clock, markup, ROUTINES, stepsFor } from "./routine";

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
