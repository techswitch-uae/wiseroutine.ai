import { beforeEach, describe, expect, it } from "vitest";
import { testAddon } from "../../addons/fixtures";
import { seedAddons } from "../../addons/installed";
import type { TodaySlot } from "../../lib/api";
import {
  forgetStarted,
  markStarted,
  runningSlot,
} from "../../lib/running-slot";
import { allModules, configFor, moduleFor } from "./index";
import { clock } from "./session-clock";

/**
 * The registry, now that there is nothing in it but addons.
 *
 * There is no built-in table any more: every guided session Wise Routine
 * ships - breathing, eye rest, the guided stretch, deep work - is an addon
 * loaded from the registry and sandboxed like anyone else's. So the questions
 * this file used to ask about four hard-coded modules ("does eye rest refuse a
 * nonsense distance") now belong to the addon packages, where they are tested
 * against the code that actually implements them.
 *
 * What is left here is the seam itself, and it matters more than what it
 * replaced: does a key resolve to the addon that owns it, does an *unknown*
 * key leave a gap rather than throw, and does an addon that is switched off
 * stop claiming its keys.
 */

const AT = Date.UTC(2026, 7, 11, 9, 0);
const WORKOUT = "acme.fitness/workout";

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
  beforeEach(() => seedAddons([testAddon()]));

  it("finds an installed addon's activity type by the key stored on the activity", () => {
    expect(moduleFor(WORKOUT)?.name).toBe("Workout");
  });

  it("has nothing for an activity with no session", () => {
    expect(moduleFor(null)).toBeUndefined();
    expect(moduleFor(undefined)).toBeUndefined();
  });

  /**
   * The behaviour the whole boundary rests on.
   *
   * An addon can be switched off, removed, or withdrawn from the registry
   * while activities naming it are still on the day. Those slots have to keep
   * running as plain timed blocks - the alternative is a user whose calendar
   * throws because somebody else's package went away.
   */
  it("has nothing for a key whose addon is not installed", () => {
    seedAddons([]);
    expect(moduleFor(WORKOUT)).toBeUndefined();
  });

  it("has nothing for a key that belongs to no addon at all", () => {
    expect(moduleFor("astrology")).toBeUndefined();
    // A bare key, which is what every session used before they were addons.
    // Rows carrying one were migrated; anything left is a plain timed slot.
    expect(moduleFor("eye_rest")).toBeUndefined();
  });

  it("refuses a key whose addon half is malformed", () => {
    expect(moduleFor("Acme.Fitness/workout")).toBeUndefined();
    expect(moduleFor("acme.fitness/")).toBeUndefined();
    expect(moduleFor("/workout")).toBeUndefined();
  });

  it("is keyed by each module's own key, so a lookup cannot miss", () => {
    for (const [key, module] of Object.entries(allModules())) {
      expect(module.key).toBe(key);
    }
  });

  it("carries the manifest's defaults through to the form", () => {
    const module = moduleFor(WORKOUT);
    expect(module?.defaults.sessionMinutes).toBe(20);
    expect(module?.defaults.startPolicy).toBe("manual");
    // Built from the settings schema, so a new field appears in the stored
    // config without the host being taught about it.
    expect(module?.defaults.config).toEqual({
      level: "steady",
      reps: 10,
      noteUrl: "",
    });
  });
});

describe("configFor", () => {
  beforeEach(() => seedAddons([testAddon()]));

  const module = () => {
    const found = moduleFor(WORKOUT);
    if (!found) throw new Error("fixture addon is not installed");
    return found;
  };

  it("falls back to the schema's defaults when nothing was stored", () => {
    expect(configFor(module(), null)).toEqual(module().defaults.config);
  });

  // The column is opaque text. Something hand-edited, truncated, or written by
  // a version that stored a different shape must not take the session down.
  it("falls back rather than throwing on unparseable text", () => {
    expect(configFor(module(), "{not json")).toEqual(module().defaults.config);
  });

  it("keeps only the fields the schema names, at the values it allows", () => {
    const stored = JSON.stringify({
      level: "hard",
      reps: 9_000,
      unknown: "smuggled",
    });
    // `reps` is out of range and falls back; `unknown` is not in the schema
    // and is dropped rather than carried around. Both matter: the host writes
    // this column back, and a field nobody declared would survive for ever.
    expect(configFor(module(), stored)).toEqual({
      level: "hard",
      reps: 10,
      noteUrl: "",
    });
  });

  it("returns what was stored when it is good", () => {
    const stored = JSON.stringify({ level: "easy", reps: 3, noteUrl: "" });
    expect(configFor(module(), stored)).toEqual({
      level: "easy",
      reps: 3,
      noteUrl: "",
    });
  });
});

describe("runningSlot", () => {
  // The set is process-wide on purpose - it is "this run of the app" - so
  // each case has to start from a fresh one.
  beforeEach(forgetStarted);

  /** Started here, the way pressing Start does it. */
  const opened = (...ids: string[]) => {
    for (const id of ids) markStarted(id);
  };

  it("finds the started slot that has a session to show", () => {
    const day = [
      slot({ id: "planned", presetKey: WORKOUT }),
      slot({ id: "live", status: "started", presetKey: WORKOUT }),
    ];
    opened("live");
    expect(runningSlot(day, AT)?.id).toBe("live");
  });

  // A slot with no session runs the way slots always did: live on the
  // timeline, finished by a press on its card. Nothing takes over the screen.
  it("ignores a started slot with no session behind it", () => {
    expect(
      runningSlot([slot({ id: "a", status: "started" })], AT),
    ).toBeUndefined();
  });

  it("takes the earlier one if two are somehow running", () => {
    const day = [
      slot({
        id: "later",
        status: "started",
        presetKey: WORKOUT,
        startsAt: AT + 60_000,
      }),
      slot({ id: "earlier", status: "started", presetKey: WORKOUT }),
    ];
    opened("later", "earlier");
    expect(runningSlot(day, AT)?.id).toBe("earlier");
  });

  /**
   * The one that made the app land in a session nobody had started.
   *
   * `started` is a status the server sets on its own for an activity that
   * starts itself, and nothing clears it if the app was not open. So a slot
   * left started this morning is still started this afternoon, and "earliest
   * wins" handed the window to it instead of the slot just pressed.
   */
  it("ignores a started slot whose time has run out", () => {
    const stale = slot({
      id: "this morning",
      status: "started",
      presetKey: WORKOUT,
      startsAt: AT - 4 * 3_600_000,
      endsAt: AT - 4 * 3_600_000 + 5 * 60_000,
    });
    const pressed = slot({
      id: "just now",
      status: "started",
      presetKey: WORKOUT,
    });
    opened("this morning", "just now");
    expect(runningSlot([stale, pressed], AT)?.id).toBe("just now");
    expect(runningSlot([stale], AT)).toBeUndefined();
  });

  /**
   * Relaunching must not drop you into a session.
   *
   * `started` outlives the app: it is a row, the server sets it on its own
   * for an activity that starts itself, and nothing clears it when the window
   * closes. So the app used to reopen straight into a full-screen session for
   * a block someone had walked away from an hour before. A session is
   * something you are in, not something the day remembers about you.
   */
  it("shows nothing for a slot this run of the app did not start", () => {
    const day = [
      slot({ id: "yesterday's", status: "started", presetKey: WORKOUT }),
    ];
    expect(runningSlot(day, AT)).toBeUndefined();
    opened("yesterday's");
    expect(runningSlot(day, AT)?.id).toBe("yesterday's");
  });

  it("has nothing to show on a day where nothing is running", () => {
    expect(
      runningSlot([slot({ id: "a", presetKey: WORKOUT })], AT),
    ).toBeUndefined();
  });
});

describe("clock", () => {
  it("pads the seconds", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(0)).toBe("0:00");
  });
});
