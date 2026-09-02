import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

/** One IIFE file, plus the manifest beside it - the same as every addon. */
const INSTALLED = join(
  import.meta.dirname,
  "../../apps/desktop/public/addons/wiseroutine.todos",
);

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "WiseRoutineTodos",
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
