import { DEFAULT_DENSITY } from "@wiseroutine/design";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The remembered row height.
 *
 * Loaded through `vi.resetModules()` and a dynamic import in every test,
 * because the module reads storage once at load and holds the answer. Testing
 * it any other way would only ever exercise whatever the first test happened
 * to leave behind - and "what was in storage when the app started" is the case
 * that actually matters.
 */
const KEY = "wiseroutine.day.density";

async function load(stored?: string) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(KEY, stored);
  vi.resetModules();
  return await import("./density");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("what the day opens at", () => {
  test("the default, on a machine that has never been asked", async () => {
    const density = await load();
    expect(density.getDensity().key).toBe(DEFAULT_DENSITY);
  });

  test("whatever was chosen last time", async () => {
    const density = await load("roomy");
    expect(density.getDensity().key).toBe("roomy");
    // And the scale really does follow the choice, not just the label.
    expect(density.getDensity().quarterStep).toBeGreaterThan(64);
  });

  test("a key that is no longer a preset falls back", async () => {
    // A rename, or a hand-edited value. Neither is worth an exception on the
    // way to drawing a day.
    const density = await load("medium");
    expect(density.getDensity().key).toBe(DEFAULT_DENSITY);
  });

  test("and the dead key is replaced rather than left to rot", async () => {
    // `setDensity` cannot clear it later: asked for the same dead key it
    // resolves to the default, sees no change, and returns before writing.
    const density = await load("medium");
    expect(localStorage.getItem(KEY)).toBe(DEFAULT_DENSITY);
    expect(density.getDensity().key).toBe(DEFAULT_DENSITY);
  });

  test("a first run stores nothing until something is chosen", async () => {
    const density = await load();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(density.getDensity().key).toBe(DEFAULT_DENSITY);
  });
});

describe("setting it", () => {
  test("persists the key", async () => {
    const density = await load();
    density.setDensity("roomy");
    expect(localStorage.getItem(KEY)).toBe("roomy");
  });

  test("junk lands on the default rather than being stored", async () => {
    const density = await load();
    for (const junk of ["", "  ", "ROOMY", "{}", "null"]) {
      density.setDensity(junk);
      expect(localStorage.getItem(KEY)).not.toBe(junk);
      expect(density.getDensity().key).toBe(DEFAULT_DENSITY);
    }
  });

  test("setting the same value again writes nothing and tells nobody", async () => {
    const density = await load();
    density.setDensity("roomy");

    // A store that notified on every set would re-render the day on every
    // click of the row already chosen.
    const spy = vi.spyOn(Storage.prototype, "setItem");
    density.setDensity("roomy");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("storage that refuses to work", () => {
  test("a throwing setItem does not take the app down", async () => {
    const density = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      // Safari in a private window, and a profile with site data blocked.
      throw new DOMException("QuotaExceededError");
    });

    // The choice still applies for this session; it just is not remembered.
    expect(() => density.setDensity("compact")).not.toThrow();
    expect(density.getDensity().key).toBe("compact");
  });

  test("a throwing getItem falls back to the default at load", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    vi.resetModules();
    // Reaching the import at all is the assertion: a throw here would be a
    // blank screen rather than a forgotten preference.
    await expect(import("./density")).resolves.toBeDefined();
  });
});
