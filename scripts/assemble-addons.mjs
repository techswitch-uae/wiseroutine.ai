import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "apps/desktop/public/addons");
const addons = readdirSync(resolve(root, "addons")).map((name) => {
  const dir = resolve(root, "addons", name);
  const manifest = JSON.parse(
    readFileSync(resolve(dir, "manifest.json"), "utf8"),
  );
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(manifest.id))
    throw new Error(`Unsafe addon id: ${manifest.id}`);
  for (const file of ["addon.js", "manifest.json"]) {
    if (!existsSync(resolve(dir, "dist", file)))
      throw new Error(
        `Missing ${name}/dist/${file}. Build through the root Turbo graph, not Vite alone.`,
      );
  }
  return { dir, id: manifest.id };
});
// Validate all inputs before replacing the staging directory. Never depend on
// a previous build's public assets (including when Turbo restores its cache).
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const addon of addons)
  cpSync(resolve(addon.dir, "dist"), resolve(target, addon.id), {
    recursive: true,
  });
