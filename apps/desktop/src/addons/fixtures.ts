import { type AddonManifest, parseManifest } from "@wiseroutine/addons";
import type { InstalledAddon } from "./installed";

/**
 * An addon, for tests that need one installed.
 *
 * Built through `parseManifest` rather than cast into shape, and that is the
 * whole point of the file: a hand-written object literal typed as
 * `AddonManifest` would let a test pass against a manifest the real parser
 * would refuse, which is precisely the class of bug the parser exists to
 * catch. Anything this fixture produces is something the app would actually
 * install.
 */

export const testManifest = (
  over: Record<string, unknown> = {},
): AddonManifest => {
  const parsed = parseManifest({
    id: "acme.fitness",
    name: "Acme Fitness",
    version: "1.0.0",
    description: "Workouts that fit the gaps.",
    capabilities: [{ kind: "ui:session" }],
    activityTypes: [
      {
        key: "workout",
        name: "Workout",
        blurb: "it counts you through the set and tells you when to stop",
        defaults: { sessionMinutes: 20, startPolicy: "manual" },
        settings: [
          {
            key: "level",
            label: "Level",
            type: "select",
            default: "steady",
            options: ["easy", "steady", "hard"],
          },
          {
            key: "reps",
            label: "Reps",
            type: "number",
            default: 10,
            min: 1,
            max: 50,
          },
          {
            key: "noteUrl",
            label: "Notes",
            type: "text",
            default: "",
            maxLength: 40,
            placeholder: "https://example.test/notes",
          },
        ],
      },
    ],
    ...over,
  });

  if (!parsed) throw new Error("fixture manifest would not parse");
  return parsed;
};

/** The manifest, plus a bundle that draws nothing. The frame is not the
 *  subject of any test that uses this. */
export const testAddon = (
  over: Record<string, unknown> = {},
): InstalledAddon => ({
  manifest: testManifest(over),
  bundle: "",
});
