import { isGrantable } from "@wiseroutine/addons";
import { describe, expect, it } from "vitest";
import { bundledEntries, entryFor, registry } from "./registry";

const IDS = [
  "wiseroutine.breathing",
  // A card in the rail and no activity type at all. It is on this list to
  // prove the widget path is one the app itself depends on, rather than one
  // kept alive for strangers.
  "wiseroutine.day-so-far",
  "wiseroutine.deep-work",
  "wiseroutine.eye-rest",
  "wiseroutine.stretch",
];

describe("registry", () => {
  it("lists every addon that ships with the app", () => {
    // A manifest that fails `parseManifest` is silently dropped, which is the
    // right behaviour and a terrible way to find out. This is the check that
    // turns "the addon vanished from the page" into a failing test.
    expect(
      registry()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(IDS);
  });

  it("only asks for capabilities that may be granted", () => {
    // The install route refuses an ungrantable capability, so an addon listed
    // here asking for one would be permanently un-installable: visible on the
    // page, and failing on the button. Better caught here.
    for (const entry of registry()) {
      for (const capability of entry.manifest.capabilities) {
        expect(isGrantable(capability)).toEqual({ ok: true });
      }
    }
  });

  it("points every bundle at the id it belongs to", () => {
    for (const entry of registry()) {
      expect(entry.bundleUrl).toBe(`/addons/${entry.id}/addon.js`);
    }
  });

  it("treats every one of them as bundled, so none of them offers an Install button", () => {
    expect(
      bundledEntries()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(IDS);
  });

  it("gives every activity type a namespaced key nothing else claims", () => {
    // `preset_key` is `addonId/typeKey` and is how an activity finds the addon
    // that runs it. Two addons claiming one key would be two sessions racing
    // to draw the same slot.
    const keys = registry().flatMap((entry) =>
      entry.manifest.activityTypes.map((type) => `${entry.id}/${type.key}`),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(4);
  });

  it("has no unknown addon", () => {
    expect(entryFor("acme.nothing")).toBeUndefined();
  });
});
