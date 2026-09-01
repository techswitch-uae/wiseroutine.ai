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
 * Where an installed addon lives.
 *
 * Writing into the app's static directory is exactly what installing a
 * downloaded addon will do - verify the signature, then put the bundle
 * somewhere the app can serve it from. This addon is bundled with the app
 * rather than downloaded, so its build does that step instead of an installer.
 * The host does not know or care which of the two put the file there; it
 * fetches a URL either way.
 */
const INSTALLED = join(
  import.meta.dirname,
  "../../apps/desktop/public/addons/wiseroutine.breathing",
);

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
