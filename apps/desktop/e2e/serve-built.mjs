import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

// Serve the exact static assets Tauri packages. Navigation falls back to the
// prerendered SPA shell; a missing script/font must never receive HTML.
const root = resolve(".output/public");
await stat(resolve(root, "index.html"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm" };
createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path === "/" ? resolve(root, "index.html") : resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) { res.writeHead(404).end(); return; }
    const found = await stat(file).catch(() => null);
    if (!found?.isFile()) {
      if (!extname(path) && req.headers.accept?.includes("text/html")) file = resolve(root, "index.html");
      else { res.writeHead(404).end(); return; }
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("Built app ready"));
