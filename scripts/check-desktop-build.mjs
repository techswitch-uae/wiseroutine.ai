#!/usr/bin/env node
/** Check the static shell Tauri ships, after Vite/Nitro have both finished.
 * Prerender failures can otherwise leave Vite exiting zero with no index.html.
 * --clean runs before the build so an old successful shell cannot mask failure.
 */
import { readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const output = fileURLToPath(
  new URL("../apps/desktop/.output/public", import.meta.url),
);
export function checkDesktopBuild(directory = output) {
  const root = realpathSync(directory);
  const requireFile = (reference) => {
    // Entry assets must be bundled locally, not fetched from a remote origin.
    if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
      throw new Error(`Non-local or missing entry asset: ${reference}`);
    }
    const path = decodeURIComponent(reference.split(/[?#]/)[0]);
    const file = resolve(root, path.replace(/^\//, ""));
    const location = relative(root, realpathSync(file));
    if (
      location.startsWith("..") ||
      isAbsolute(location) ||
      !statSync(file).isFile() ||
      statSync(file).size === 0
    ) {
      throw new Error(`Missing, empty or out-of-output asset: ${reference}`);
    }
    return file;
  };
  const html = readFileSync(requireFile("index.html"), "utf8");
  if (!/<html\b/i.test(html) || !/<\/html\s*>/i.test(html))
    throw new Error("Incomplete prerendered index.html");
  const attribute = (tag, name) =>
    tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  let entries = 0;
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    if (/^<script\b/i.test(tag)) {
      const src = attribute(tag, "src");
      if (src !== undefined) requireFile(src);
      if (attribute(tag, "type") === "module" && src) entries++;
    } else if (
      ["stylesheet", "modulepreload"].includes(attribute(tag, "rel"))
    ) {
      requireFile(attribute(tag, "href"));
    }
  }
  if (!entries) throw new Error("No bundled module entry in index.html");
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--clean" && args.length === 1)
      rmSync(output, { recursive: true, force: true });
    else {
      if (args.length > 1 || args[0]?.startsWith("--"))
        throw new Error(
          "Usage: check-desktop-build.mjs [output-directory | --clean]",
        );
      checkDesktopBuild(args[0]);
      console.log("[desktop-build] Static shell and entry assets verified.");
    }
  } catch (error) {
    console.error(`[desktop-build] ${error.message}`);
    process.exitCode = 1;
  }
}
