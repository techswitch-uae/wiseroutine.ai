import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

/**
 * One IIFE file, plus the manifest beside it.
 *
 * Identical to every other addon's, and that is the point worth noting here:
 * this one contributes no guided session at all, only a card in the rail, and
 * it still builds, installs, is granted, sandboxed and served by exactly the
 * same path. A widget-only addon is not a second kind of thing.
 */
const INSTALLED = join(
  import.meta.dirname,
  "../../apps/desktop/public/addons/wiseroutine.day-so-far",
);

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "WiseRoutineDaySoFar",
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
