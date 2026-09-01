import { beforeEach, describe, expect, it } from "vitest";
import type { TodaySlot } from "../../lib/api";
import { spotifyEmbed } from "../../lib/music";
import {
  forgetStarted,
  markStarted,
  runningSlot,
} from "../../lib/running-slot";
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
    expect(moduleFor("stretch")).toBe(stretch);
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
    expect(configFor(eyeRest, "{not json")).toEqual(eyeRest.defaults.config);
  });

  it("falls back on JSON of the wrong shape", () => {
    expect(configFor(stretch, '{"steps":"soon"}')).toEqual(
      stretch.defaults.config,
    );
  });

  it("returns what was stored when it is good", () => {
    expect(configFor(eyeRest, JSON.stringify({ metres: 12 }))).toEqual({
      metres: 12,
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

/**
 * Breathing is an addon now, so its pacer, its patterns and its settings are
 * tested in `addons/breathing`. What is still this file's business is that a
 * key belonging to an addon is looked up rather than ignored, and that a key
 * belonging to an addon which is not installed leaves a gap.
 */
describe("an addon's activity type", () => {
  it("is not in the app's own registry", () => {
    expect(MODULES["wiseroutine.breathing/pacer"]).toBeUndefined();
  });

  // Nothing is installed in a unit test, so this is the uninstalled case -
  // which is the one that has to be safe. An activity created by an addon the
  // user has since removed still has rows naming it, and those slots keep
  // running as plain timed ones.
  it("is undefined when its addon is not installed", () => {
    expect(moduleFor("wiseroutine.breathing/pacer")).toBeUndefined();
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

/**
 * The one function here that decides the `src` of an iframe.
 *
 * It is handed a string the user typed, so what matters is what it refuses.
 * It takes the kind and the id out of a shape it recognises and builds a
 * fresh URL from them - nothing typed can reach the frame except a Spotify
 * id.
 */
describe("spotifyEmbed", () => {
  it("embeds the link the web player copies", () => {
    expect(spotifyEmbed("https://open.spotify.com/playlist/37i9dQZF1DX")).toBe(
      "https://open.spotify.com/embed/playlist/37i9dQZF1DX",
    );
  });

  it("embeds the URI the desktop app copies", () => {
    expect(spotifyEmbed("spotify:album:1DFixLWuPkv3KT3TnV35m3")).toBe(
      "https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3",
    );
  });

  // The web player puts a locale in front of the kind for most of the world.
  it("looks past a locale segment", () => {
    expect(spotifyEmbed("https://open.spotify.com/intl-it/track/abc123")).toBe(
      "https://open.spotify.com/embed/track/abc123",
    );
  });

  it("drops the query Spotify's share button adds", () => {
    expect(
      spotifyEmbed("https://open.spotify.com/track/abc123?si=deadbeef"),
    ).toBe("https://open.spotify.com/embed/track/abc123");
  });

  it("refuses a host that only looks like Spotify", () => {
    expect(
      spotifyEmbed("https://open.spotify.com.evil.test/track/a"),
    ).toBeNull();
    expect(spotifyEmbed("https://notspotify.com/track/a")).toBeNull();
  });

  it("refuses anything that is not one of Spotify's own kinds", () => {
    expect(spotifyEmbed("https://open.spotify.com/user/someone")).toBeNull();
  });

  it("has nothing to embed for another service", () => {
    expect(spotifyEmbed("https://music.apple.com/playlist/x")).toBeNull();
    expect(spotifyEmbed("")).toBeNull();
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
      slot({ id: "planned", presetKey: "eye_rest" }),
      slot({ id: "live", status: "started", presetKey: "breathing" }),
    ];
    opened("live");
    expect(runningSlot(day, AT)?.id).toBe("live");
  });

  // A slot with no module runs the way slots always did: live on the timeline,
  // finished by a press on its card. Nothing takes over the screen.
  it("ignores a started slot with no module behind it", () => {
    expect(
      runningSlot([slot({ id: "a", status: "started" })], AT),
    ).toBeUndefined();
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
      presetKey: "eye_rest",
      startsAt: AT - 4 * 3_600_000,
      endsAt: AT - 4 * 3_600_000 + 5 * 60_000,
    });
    const pressed = slot({
      id: "just now",
      status: "started",
      presetKey: "breathing",
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
      slot({ id: "yesterday's", status: "started", presetKey: "eye_rest" }),
    ];
    expect(runningSlot(day, AT)).toBeUndefined();
    opened("yesterday's");
    expect(runningSlot(day, AT)?.id).toBe("yesterday's");
  });

  it("has nothing to show on a day where nothing is running", () => {
    expect(
      runningSlot([slot({ id: "a", presetKey: "eye_rest" })], AT),
    ).toBeUndefined();
  });
});

describe("clock", () => {
  it("pads the seconds", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(0)).toBe("0:00");
  });
});
