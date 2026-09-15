import { describe, expect, it } from "vitest";
import { clock, markup, secondsLeft, sentence } from "./rest";

describe("clock", () => {
  it("pads the seconds", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(600)).toBe("10:00");
    expect(clock(0)).toBe("0:00");
  });
});

describe("secondsLeft", () => {
  it("never goes negative", () => {
    expect(secondsLeft(1_000, 9_000)).toBe(0);
  });

  it("rounds, so the first second shown is the whole duration", () => {
    // 300s minus a sliver. Floored this would open at 4:59.
    expect(secondsLeft(300_400, 400)).toBe(300);
  });
});

describe("sentence", () => {
  it("uses the configured distance", () => {
    expect(sentence(3)).toContain("about 3 metres");
  });

  it("falls back rather than saying NaN", () => {
    // A config edited by hand, or written by a version that stored a string.
    for (const bad of [undefined, null, "six", Number.NaN, Infinity]) {
      expect(sentence(bad)).toContain("about 6 metres");
    }
  });

  it("clamps a distance outside what the schema allows", () => {
    expect(sentence(9_000)).toContain("about 50 metres");
    expect(sentence(0)).toContain("about 1 metres");
  });
});

describe("markup", () => {
  it("draws on a transparent ground", () => {
    // The host paints the dim canvas behind the frame. A frame with its own
    // background paints a lighter rectangle on top of it, which is visible in
    // the packaged webview and invisible in a browser.
    expect(markup("x")).toContain("background: transparent");
  });

  it("carries the sentence it was given", () => {
    expect(markup("Look somewhere")).toContain("Look somewhere");
  });
});
