import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { preview } from "../../../packages/addon-tools/lib/preview.mjs";

const directory = await mkdtemp(join(tmpdir(), "wr-addon-browser-"));
const sdk = fileURLToPath(
  new URL("../../../packages/addon-sdk/dist/index.js", import.meta.url),
);
await mkdir(join(directory, "src"));
await writeFile(
  join(directory, "manifest.json"),
  JSON.stringify({
    id: "example.browser",
    version: "1.0.0",
    name: "Browser fixture",
    description: "Synthetic conformance addon",
    capabilities: [
      { kind: "ui:widget" },
      { kind: "ui:session" },
      { kind: "write:todos" },
      { kind: "read:todos" },
      { kind: "write:own" },
      { kind: "read:schedule", scope: "today" },
      { kind: "notify" },
    ],
    widgets: [{ key: "card", name: "Card" }],
    activityTypes: ["pause", "stretch"].map((key) => ({
      key,
      name: key,
      blurb: key,
      defaults: { sessionMinutes: 2, startPolicy: "manual" },
    })),
    quickAdd: [{ key: "todo", name: "Synthetic todo" }],
  }),
);
await writeFile(
  join(directory, "src/main.js"),
  `import { connect } from ${JSON.stringify(sdk)};
const show = (id, text) => { let el = document.getElementById(id); if (!el) { el = document.createElement("p"); el.id = id; document.body.append(el); } el.textContent = text; };
async function main() {
 const wr = await connect();
 let isolated = false; try { parent.document.body; } catch { isolated = true; } show("isolation", String(isolated));
 let privateStore = false; try { localStorage.getItem("session"); } catch { privateStore = true; } show("storage", String(privateStore));
 try { await fetch("https://example.invalid/no-egress"); } catch { show("network", "blocked"); }
 if (wr.role.kind === "widget") { await wr.card({ height: 160 }); show("role", "widget:" + wr.role.widgetKey); }
 if (wr.role.kind === "session") { const session = await wr.session(); show("role", "session:" + session.activityTypeKey); const done = document.createElement("button"); done.textContent = "Finish"; done.onclick = () => wr.finishSession(); document.body.append(done); }
 const day = await wr.day(); show("day", String(day.slots.length));
 const placed = await wr.placeSlot({ title: "Synthetic block", kind: "task", minutes: 5 }); await wr.setSlotStatus(placed.id, "completed");
 await wr.store.set("fixture", "kept"); show("stored", String(await wr.store.get("fixture")));
 await wr.todos.list(); await wr.notify({ title: "Synthetic notice" });
 wr.onQuickAdd(async request => { await wr.todos.add({ title: request.title }); return "Created synthetic todo"; });
}
main().catch(error => show("error", error.kind + ": " + error.message));`,
);
await build({
  configFile: false,
  root: directory,
  logLevel: "error",
  build: {
    outDir: "dist",
    lib: {
      entry: join(directory, "src/main.js"),
      name: "Fixture",
      formats: ["iife"],
      fileName: () => "addon.js",
    },
  },
});
const server = await preview(directory, 4177);
process.once("SIGTERM", () => {
  server.closeAllConnections();
  server.close(() => {
    void rm(directory, { recursive: true, force: true }).finally(() =>
      process.exit(),
    );
  });
});
