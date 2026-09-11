import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

/**
 * One file, no imports left over.
 *
 * The host injects this bundle into a sandboxed frame with an opaque origin,
 * so there is nothing to load a second file *from*: `addon.js` has to be the
 * whole addon, dependencies included. IIFE rather than ESM for the same
 * reason - a module script in a `srcdoc` document cannot resolve a bare
 * specifier, and there is no import map to give it one.
 *
 * Every addon builds like this. It is the shape the host knows how to run.
 */

/**
 * A package-local, cacheable bundle. The desktop's assembly step copies all
 * bundled addons into its static assets after their dependency builds finish.
 * Native installation is separate and puts verified bundles into the active
 * account's addon directory.
 */
const INSTALLED = join(import.meta.dirname, "dist");

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "WiseRoutineBreathing",
      fileName: () => "addon.js",
    },
    outDir: INSTALLED,
    emptyOutDir: true,
    // A session is on screen the moment a slot starts; a sourcemap is another
    // request the frame cannot make and a name the addon need not publish.
    sourcemap: false,
    target: "es2022",
  },
  plugins: [
    {
      name: "wr-copy-manifest",
      // Beside the bundle rather than inside it, and this is load-bearing:
      // the host reads the manifest to decide what the addon may do, and it
      // has to be able to do that *without executing the addon*. A manifest
      // the bundle exported would be a permission list written by the code it
      // is meant to constrain.
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
