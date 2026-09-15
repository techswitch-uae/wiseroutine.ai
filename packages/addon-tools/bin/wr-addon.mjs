#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { preview } from "../lib/preview.mjs";
import {
  readBounded,
  releasePayload,
  validateDirectory,
} from "../lib/validate.mjs";

const [command, directory = ".", ...args] = process.argv.slice(2);
try {
  if (command === "init") {
    const target = resolve(directory);
    await mkdir(target); // Never overwrite an existing project.
    await mkdir(join(target, "src"));
    const manifest = {
      id: "yourname.hello",
      name: "Hello routine",
      version: "1.0.0",
      apiVersion: 1,
      description: "A small guided session and optional card.",
      capabilities: [{ kind: "ui:widget" }, { kind: "ui:session" }],
      widgets: [{ key: "hello", name: "Hello" }],
      activityTypes: [
        {
          key: "pause",
          name: "Pause",
          blurb: "take a short pause",
          defaults: { sessionMinutes: 2, startPolicy: "manual" },
        },
      ],
      quickAdd: [{ key: "hello", name: "Say hello" }],
    };
    const pkg = {
      name: "hello-routine-addon",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        build: "vite build",
        preview: "wr-addon preview .",
        validate: "wr-addon validate .",
        package: "wr-addon package .",
      },
      dependencies: { "@wiseroutine/addon-sdk": "^0.1.0" },
      devDependencies: { "@wiseroutine/addon-tools": "^0.1.0", vite: "8.2.2" },
    };
    await writeFile(
      join(target, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`,
    );
    await writeFile(
      join(target, "vite.config.js"),
      `export default { build: { lib: { entry: "src/main.js", name: "Addon", formats: ["iife"], fileName: () => "addon.js" }, outDir: "dist", emptyOutDir: true, sourcemap: false } };\n`,
    );
    await writeFile(
      join(target, "src/main.js"),
      `import { connect } from "@wiseroutine/addon-sdk";\nasync function main() {\n  const wr = await connect();\n  if (wr.role.kind === "widget") await wr.card({ eyebrow: "A small pause", height: 160 });\n  const text = document.createElement("p"); text.textContent = "Breathe. Make room for the next thing."; document.body.append(text);\n  if (wr.role.kind === "session") {\n    const session = await wr.session();\n    const done = document.createElement("button"); done.textContent = "Done: " + (session.activityTypeKey ?? "pause"); done.onclick = () => wr.finishSession(); document.body.append(done);\n  }\n  wr.onQuickAdd(() => "Hello from your addon");\n}\nmain().catch(error => { document.body.textContent = error.message; });\n`,
    );
    await writeFile(
      join(target, "submission.example.json"),
      `${JSON.stringify(
        {
          author: "Your name",
          license: "MIT",
          source: {
            repository: "https://github.com/OWNER/REPO",
            commit: "REPLACE_WITH_FULL_40_CHARACTER_COMMIT",
          },
          support: "https://github.com/OWNER/REPO/issues",
          privacy: "Explain every data read/write and retention choice.",
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `Created ${target}. Rename the addon ID, install dependencies, then npm run build and npm run preview. Before npm publication, use the exported kit's local tarballs (see README).`,
    );
  } else if (command === "validate" || command === "package") {
    const build = await validateDirectory(directory, {
      community: !args.includes("--bundled"),
    });
    if (command === "package") {
      if (args.includes("--bundled"))
        throw new Error(
          "Bundled examples are not community submissions; fork with a non-reserved ID",
        );
      const submission = JSON.parse(
        await readBounded(join(directory, "submission.json"), 8192),
      );
      const payload = releasePayload(build, submission);
      const license = await readBounded(join(directory, "LICENSE"), 128 * 1024);
      if (!license.trim()) throw new Error("Missing license text");
      const out = resolve(
        args.find((arg) => !arg.startsWith("--")) ?? join(directory, "release"),
      );
      await mkdir(out); // immutable output: never silently replace an artifact
      await writeFile(join(out, "addon.js"), build.bundle);
      await writeFile(
        join(out, "manifest.json"),
        `${JSON.stringify(build.manifest, null, 2)}\n`,
      );
      await writeFile(
        join(out, "payload.json"),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
      await writeFile(
        join(out, "submission.json"),
        `${JSON.stringify(submission, null, 2)}\n`,
      );
      // License text is mandatory, not just package metadata.
      await writeFile(join(out, "LICENSE"), license);
      console.log(`Unapproved review artifact: ${out}`);
    }
    console.log(
      `${build.manifest.id}@${build.manifest.version} sha256:${build.bundleHash}`,
    );
  } else if (command === "preview") {
    const portIndex = args.indexOf("--port");
    const port = portIndex < 0 ? 4173 : Number(args[portIndex + 1]);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const server = await preview(directory, port);
    console.log(
      `Synthetic addon host: http://127.0.0.1:${server.address().port}\nNo account, no billing, no real calendar data. Rebuild the addon and restart preview to update.`,
    );
  } else {
    console.log(
      "wr-addon init <new-directory>\nwr-addon validate <directory> [--bundled]\nwr-addon preview <directory> [--port 4173]\nwr-addon package <directory> [new-output-directory]",
    );
    if (command && command !== "help") process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
