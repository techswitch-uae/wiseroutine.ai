import { describe, expect, it } from "vitest";
import { barKeyframes, markup, patternFor, phaseAt } from "./pacer";

/**
 * The addon's own tests.
 *
 * An addon is a package, and a package with logic in it has tests. These
 * moved here from the app when the breathing session did: they always
 * belonged to the pacer rather than to the registry it happened to be listed
 * in, and now there is somewhere for them to live.
 *
 * Note what is not tested: that Done completes the slot, that Stop is a skip
 * and never a completion, that the session renders `role="dialog"`. Those are
 * the *host's* invariants, they are asserted in the app against every session
 * including this one, and an addon cannot break them because it cannot draw
 * them.
 */

const BOX = [4, 4, 4, 4] as const;
const P478 = [4, 7, 8, 0] as const;

describe("naming the phase", () => {
  it("names the phase the pattern is in", () => {
    expect(phaseAt(BOX, 0)).toBe("Breathe in");
    expect(phaseAt(BOX, 5)).toBe("Hold");
    expect(phaseAt(BOX, 9)).toBe("Breathe out");
  });

  it("repeats every cycle", () => {
    expect(phaseAt(BOX, 16)).toBe(phaseAt(BOX, 0));
  });

  // 4-7-8 has no closing hold. Flashing the word for an instant would be a lie
  // about the pattern.
  it("skips a phase the pattern gives no time to", () => {
    // The last second of the out-breath, which runs to 19; there is no hold
    // after it, so the cycle wraps straight back to the in-breath.
    expect(phaseAt(P478, 18)).toBe("Breathe out");
    expect(phaseAt(P478, 19)).toBe("Breathe in");
  });

  it("survives a pattern that would never move", () => {
    expect(phaseAt([0, 0, 0, 0], 3)).toBe("Breathe in");
  });
});

/**
 * The bar under the phase: full at the start of each phase, empty by the end
 * of it. A countdown you do not have to read.
 */
describe("the phase bar", () => {
  it("drains once per phase, and refills off the boundary", () => {
    // 4-7-8, whose fourth phase is zero: three sweeps, not four.
    const frames = barKeyframes(P478, 19);
    const drains = frames.match(/stroke-dashoffset: 98\b/g) ?? [];
    expect(drains.length).toBe(3);
    // Nothing sits on a boundary twice: two keyframes at one stop are one
    // keyframe, and the refill would eat the phase that just drained.
    const stops = [...frames.matchAll(/([\d.]+)% \{/g)].map((m) => m[1]);
    expect(new Set(stops).size).toBe(stops.length);
    // The last phase ends the cycle, so it has nothing to refill into.
    expect(frames.trimEnd().endsWith("} }")).toBe(true);
  });
});

/**
 * The host validates settings against the manifest's schema before this addon
 * ever sees them, so `config.pattern` is one of the three names or absent.
 * Falling back anyway is cheap and means a manifest edit cannot produce a
 * session that throws instead of breathing.
 */
describe("reading its settings", () => {
  it("takes the named pattern", () => {
    expect(patternFor({ pattern: "4-7-8" })).toEqual([4, 7, 8, 0]);
  });

  it.each([undefined, null, {}, { pattern: 42 }, { pattern: "made up" }])(
    "falls back to box breathing for %o",
    (config) => {
      expect(patternFor(config)).toEqual([4, 4, 4, 4]);
    },
  );
});

describe("what it draws", () => {
  it("paces both animations off one cycle length", () => {
    // The word and the circle are two clocks describing one breath. 4-7-8 is
    // a nineteen-second cycle, and both animations have to say so or they
    // drift apart within a minute.
    const html = markup(P478);
    expect(html).toContain("wr-breathe 19s");
    expect(html).toContain("wr-breathe-bar 19s");
  });

  /**
   * The frame the addon runs in has no origin, so it cannot fetch anything.
   * A stylesheet, a font or an image URL here would silently draw nothing -
   * and would also be refused by the frame's `default-src 'none'`.
   */
  it("reaches for nothing outside its own frame", () => {
    const html = markup(BOX);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<link");
  });
});
