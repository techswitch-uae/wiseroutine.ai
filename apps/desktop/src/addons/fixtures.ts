import { type AddonManifest, parseManifest } from "@wiseroutine/addons";
import type { InstalledAddon } from "./installed";

/**
 * An addon, for tests that need one installed. Built through
 * `parseManifest`, so a fixture is always something the app would install.
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

/** The manifest, granted everything it asks for, with a bundle that draws
 *  nothing. */
export const testAddon = (
  over: Record<string, unknown> = {},
): InstalledAddon => {
  const manifest = testManifest(over);
  return {
    manifest,
    granted: manifest.capabilities,
    settings: {},
    author: "Acme",
    bundled: false,
    bundle: "",
  };
};
