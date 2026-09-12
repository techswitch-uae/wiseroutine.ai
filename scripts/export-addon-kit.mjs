import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";
import { addonKitLock } from "./addon-kit-lock.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2] && resolve(process.argv[2]);
if (!target)
  throw new Error("Usage: node scripts/export-addon-kit.mjs <new-directory>");
await mkdir(target); // Deliberately refuses an existing tree. No .git or credentials copied.
const excluded = new Set(["node_modules", ".turbo", ".cache", ".DS_Store"]);
const topLevel = new Set([
  "src",
  "dist",
  "bin",
  "lib",
  "preview",
  "test",
  "package.json",
  "manifest.json",
  "manifest.schema.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "vite.config.ts",
  "base.json",
  "vite.json",
  "workers.json",
  "LICENSE",
  "README.md",
]);
async function copyTree(source, destination, depth = 0) {
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) {
    if (
      excluded.has(name) ||
      name.startsWith(".") ||
      name.endsWith(".local") ||
      (depth === 0 && !topLevel.has(name))
    )
      continue;
    const from = join(source, name),
      to = join(destination, name),
      info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink: ${from}`);
    if (info.isDirectory()) await copyTree(from, to, depth + 1);
    else if (
      info.isFile() &&
      (name === "LICENSE" || /\.(ts|js|mjs|json|html|css|md)$/.test(name))
    )
      await copyFile(from, to);
  }
}
// Explicit public boundary. Never walk the repository root or apps/.
for (const name of ["addon-sdk", "addons", "addon-tools", "typescript-config"])
  await copyTree(join(root, "packages", name), join(target, "packages", name));
for (const name of [
  "breathing",
  "day-so-far",
  "deep-work",
  "eye-rest",
  "stretch",
  "todos",
])
  await copyTree(join(root, "addons", name), join(target, "addons", name));
for (const name of [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SPEC.md",
  "SUBMISSIONS.md",
])
  await copyFile(join(root, "docs/addon-kit", name), join(target, name));
await copyFile(
  join(root, "packages/addon-sdk/LICENSE"),
  join(target, "LICENSE"),
);
await mkdir(join(target, ".github/workflows"), { recursive: true });
await copyFile(
  join(root, "docs/addon-kit/ci.yml"),
  join(target, ".github/workflows/ci.yml"),
);
await mkdir(join(target, "submissions"));
await copyFile(
  join(root, "addon-registry/submission.example.json"),
  join(target, "submissions/example.json"),
);
await writeFile(
  join(target, "package.json"),
  `${JSON.stringify(
    {
      name: "wiseroutine-addon-kit",
      private: true,
      type: "module",
      packageManager: "pnpm@10.30.1",
      engines: { node: ">=24" },
      scripts: {
        build: "pnpm -r --sort build",
        test: "pnpm run build && pnpm -r test",
        typecheck: "pnpm -r typecheck",
        addon: "node packages/addon-tools/bin/wr-addon.mjs",
      },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(target, "pnpm-workspace.yaml"),
  "packages:\n  - packages/*\n  - addons/*\n",
);
await writeFile(
  join(target, ".gitignore"),
  "node_modules\ndist\n.turbo\n*.tgz\n.env*\n",
);
await writeFile(join(target, ".node-version"), "24.15.0\n");
// Keep exact reviewed dependency versions, without exposing private importers or their graph.
const publicPaths = ["addon-sdk", "addons", "addon-tools", "typescript-config"]
  .map((name) => `packages/${name}`)
  .concat(
    [
      "breathing",
      "day-so-far",
      "deep-work",
      "eye-rest",
      "stretch",
      "todos",
    ].map((name) => `addons/${name}`),
  );
const lock = addonKitLock(
  load(await readFile(join(root, "pnpm-lock.yaml"), "utf8")),
  publicPaths,
);
await writeFile(
  join(target, "pnpm-lock.yaml"),
  dump(lock, { noRefs: true, lineWidth: 120 }),
);
console.log(
  `Exported public addon kit to ${target}, including a pruned public-only lockfile. Review licenses and run its frozen install/build/test/typecheck before publishing. Nothing was published.`,
);
