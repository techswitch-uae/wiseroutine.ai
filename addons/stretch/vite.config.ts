import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

/**
 * One IIFE file, plus the manifest beside it.
 *
 * Every addon builds exactly like this and for the reasons written out in
 * `addons/breathing/vite.config.ts`, which is the reference: the bundle is
 * injected into a frame with an opaque origin, so it can load nothing else,
 * and the manifest must be readable *without* executing the bundle.
 */
const INSTALLED = join(
  import.meta.dirname,
  "../../apps/desktop/public/addons/wiseroutine.stretch",
);

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "WiseRoutineStretch",
      fileName: () => "addon.js",
    },
    outDir: INSTALLED,
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  plugins: [
    {
      name: "wr-copy-manifest",
      closeBundle() {
        mkdirSync(INSTALLED, { recursive: true });
        copyFileSync(
          join(import.meta.dirname, "manifest.json"),
          join(INSTALLED, "manifest.json"),
        );
      },
    },
  ],
});
