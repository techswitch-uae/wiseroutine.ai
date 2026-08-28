import { describe, expect, test } from "vitest";
import { MAX_REPLAY_AGE_MS, replayedAt } from "./replay";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_700_000_000_000;

describe("replayedAt", () => {
  // The case this exists for: a flight's worth of actions arriving at once.
  test("an action from hours ago keeps its own time", () => {
    expect(replayedAt(NOW, NOW - 6 * HOUR)).toBe(NOW - 6 * HOUR);
  });

  test("no claim means now", () => {
    expect(replayedAt(NOW, undefined)).toBe(NOW);
  });

  test("a claim that is not a number means now", () => {
    expect(replayedAt(NOW, Number.NaN)).toBe(NOW);
    expect(replayedAt(NOW, Number.POSITIVE_INFINITY)).toBe(NOW);
  });

  // A device clock running fast must not be able to record the future - the
  // grace sweep reads these instants, and a slot completed "later today"
  // would sit there unresolved.
  test("the future collapses to now", () => {
    expect(replayedAt(NOW, NOW + HOUR)).toBe(NOW);
    expect(replayedAt(NOW, NOW + 1)).toBe(NOW);
  });

  test("now itself is accepted", () => {
    expect(replayedAt(NOW, NOW)).toBe(NOW);
  });

  test("the edge of the window is still trusted", () => {
    const edge = NOW - MAX_REPLAY_AGE_MS;
    expect(replayedAt(NOW, edge)).toBe(edge);
  });

  // Beyond the window we fall back to now rather than clamping: clamping
  // would invent a precise past that nothing observed.
  test("beyond the window falls back to now, not to the edge", () => {
    const ancient = NOW - MAX_REPLAY_AGE_MS - MINUTE;
    expect(replayedAt(NOW, ancient)).toBe(NOW);
    expect(replayedAt(NOW, 0)).toBe(NOW);
  });

  test("the result is never outside [now - window, now]", () => {
    const claims = [
      NOW + 10 * HOUR,
      NOW,
      NOW - HOUR,
      NOW - MAX_REPLAY_AGE_MS,
      NOW - 400 * 24 * HOUR,
      Number.NaN,
    ];
    for (const claim of claims) {
      const result = replayedAt(NOW, claim);
      expect(result).toBeLessThanOrEqual(NOW);
      expect(result).toBeGreaterThanOrEqual(NOW - MAX_REPLAY_AGE_MS);
    }
  });
});
