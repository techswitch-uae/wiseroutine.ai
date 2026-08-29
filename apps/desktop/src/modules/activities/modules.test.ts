import { describe, expect, it } from "vitest";
import type { TodaySlot } from "../../lib/api";
import { runningSlot } from "../../lib/running-slot";
import { breathing, PATTERNS, phaseAt } from "./breathing";
import { deepWork } from "./deep-work";
import { eyeRest } from "./eye-rest";
import { configFor, MODULES, moduleFor } from "./index";
import { clock } from "./session-clock";
import { stretch } from "./stretch";

const AT = Date.UTC(2026, 7, 11, 9, 0);

const slot = (over: Partial<TodaySlot> & { id: string }): TodaySlot => ({
  title: "Eye rest",
  kind: "recovery",
  startsAt: AT,
  endsAt: AT + 5 * 60_000,
  status: "planned",
  isLocked: false,
  conflictEventId: null,
  ...over,
});

describe("the registry", () => {
  it("finds a module by the key stored on the activity", () => {
    expect(moduleFor("breathing")).toBe(breathing);
  });

  it("has nothing for an activity with no module", () => {
    expect(moduleFor(null)).toBeUndefined();
    expect(moduleFor(undefined)).toBeUndefined();
  });

  // A module removed in a later version leaves rows behind that still name it.
  // Those activities must keep working as plain timed slots, not crash.
  it("has nothing for a key it has never heard of", () => {
    expect(moduleFor("astrology")).toBeUndefined();
  });

  it("is keyed by each module's own key, so a lookup cannot miss", () => {
    for (const [key, module] of Object.entries(MODULES)) {
      expect(module.key).toBe(key);
    }
  });
});

describe("configFor", () => {
  it("falls back to the module's defaults when nothing was stored", () => {
    expect(configFor(eyeRest, null)).toEqual(eyeRest.defaults.config);
  });

  // The column is opaque text. Something hand-edited, truncated, or written by
  // a version that stored a different shape must not take the session down.
  it("falls back rather than throwing on unparseable text", () => {
    expect(configFor(breathing, "{not json")).toEqual(
      breathing.defaults.config,
    );
  });

  it("falls back on JSON of the wrong shape", () => {
    expect(configFor(stretch, '{"steps":"soon"}')).toEqual(
      stretch.defaults.config,
    );
  });

  it("returns what was stored when it is good", () => {
    const stored = JSON.stringify({ pattern: PATTERNS["4-7-8"] });
    expect(configFor(breathing, stored)).toEqual({
      pattern: PATTERNS["4-7-8"],
    });
  });
});

describe("eye rest", () => {
  // The point of the policy. An eye rest you have to press a button for is an
  // eye rest you skip.
  it("starts itself by default", () => {
    expect(eyeRest.defaults.startPolicy).toBe("auto");
  });

  it("refuses a nonsense distance", () => {
    expect(eyeRest.parse({ metres: -3 }).metres).toBe(6);
    expect(eyeRest.parse({ metres: "far" }).metres).toBe(6);
  });
});

describe("breathing", () => {
  it("names the phase the pattern is in", () => {
    const box = PATTERNS["box 4-4-4-4"];
    if (!box) throw new Error("missing pattern");
    expect(phaseAt(box, 0).label).toBe("Breathe in");
    expect(phaseAt(box, 5).label).toBe("Hold");
    expect(phaseAt(box, 9).label).toBe("Breathe out");
  });

  it("repeats every cycle", () => {
    const box = PATTERNS["box 4-4-4-4"];
    if (!box) throw new Error("missing pattern");
    expect(phaseAt(box, 16).label).toBe(phaseAt(box, 0).label);
  });

  // 4-7-8 has no closing hold. Flashing the word for an instant would be a lie
  // about the pattern.
  it("skips a phase the pattern gives no time to", () => {
    const p478 = PATTERNS["4-7-8"];
    if (!p478) throw new Error("missing pattern");
    // The last second of the out-breath, which runs to 19; there is no hold
    // after it, so the cycle wraps straight back to the in-breath.
    expect(phaseAt(p478, 18).label).toBe("Breathe out");
    expect(phaseAt(p478, 19).label).toBe("Breathe in");
  });

  it("refuses a pattern that would never move", () => {
    expect(breathing.parse({ pattern: [0, 0, 0, 0] })).toEqual(
      breathing.defaults.config,
    );
  });

  it("refuses a pattern of the wrong length", () => {
    expect(breathing.parse({ pattern: [4, 4] })).toEqual(
      breathing.defaults.config,
    );
  });
});

describe("stretch", () => {
  it("ships the four steps from the design", () => {
    expect(stretch.defaults.config.steps).toHaveLength(4);
  });

  it("refuses an empty routine, which would render nothing", () => {
    expect(stretch.parse({ steps: [] })).toEqual(stretch.defaults.config);
  });

  it("refuses a step with no time on it", () => {
    expect(stretch.parse({ steps: [{ text: "Stand", seconds: 0 }] })).toEqual(
      stretch.defaults.config,
    );
  });
});

describe("deep work", () => {
  it("keeps a playlist link", () => {
    const url = "https://open.spotify.com/playlist/37i9dQZF1DX";
    expect(deepWork.parse({ musicUrl: url }).musicUrl).toBe(url);
  });

  it("keeps a native app link", () => {
    expect(deepWork.parse({ musicUrl: "spotify:playlist:abc" }).musicUrl).toBe(
      "spotify:playlist:abc",
    );
  });

  // A settings field that will be opened is a place to put something dangerous.
  // Dropped when stored, so a bad value can never reach `openExternal`.
  it("drops a scheme that is not a link to music", () => {
    expect(deepWork.parse({ musicUrl: "javascript:alert(1)" }).musicUrl).toBe(
      "",
    );
    expect(deepWork.parse({ musicUrl: "file:///etc/passwd" }).musicUrl).toBe(
      "",
    );
  });
});

describe("runningSlot", () => {
  it("finds the started slot that has a session to show", () => {
    const day = [
      slot({ id: "planned", presetKey: "eye_rest" }),
      slot({ id: "live", status: "started", presetKey: "breathing" }),
    ];
    expect(runningSlot(day)?.id).toBe("live");
  });

  // A slot with no module runs the way slots always did: live on the timeline,
  // finished by a press on its card. Nothing takes over the screen.
  it("ignores a started slot with no module behind it", () => {
    expect(runningSlot([slot({ id: "a", status: "started" })])).toBeUndefined();
  });

  it("takes the earlier one if two are somehow running", () => {
    const day = [
      slot({
        id: "later",
        status: "started",
        presetKey: "breathing",
        startsAt: AT + 60_000,
      }),
      slot({ id: "earlier", status: "started", presetKey: "eye_rest" }),
    ];
    expect(runningSlot(day)?.id).toBe("earlier");
  });

  it("has nothing to show on a day where nothing is running", () => {
    expect(
      runningSlot([slot({ id: "a", presetKey: "eye_rest" })]),
    ).toBeUndefined();
  });
});

describe("clock", () => {
  it("pads the seconds", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(0)).toBe("0:00");
  });
});
