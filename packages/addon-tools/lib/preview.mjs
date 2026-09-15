import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { contractURL, validateDirectory } from "./validate.mjs";
export async function preview(directory, port = 4173) {
  const build = await validateDirectory(directory, { community: false });
  const files = new Map([
    ["/", ["text/html", new URL("../preview/index.html", import.meta.url)]],
    [
      "/host.js",
      ["text/javascript", new URL("../preview/host.js", import.meta.url)],
    ],
    ["/contract.js", ["text/javascript", contractURL]],
    [
      "/manifest.js",
      ["text/javascript", new URL("./manifest.js", contractURL)],
    ],
    [
      "/releases.js",
      ["text/javascript", new URL("./releases.js", contractURL)],
    ],
    ["/index.js", ["text/javascript", contractURL]],
  ]);
  const server = createServer(async (req, res) => {
    const address = server.address();
    if (
      req.headers.host !== `127.0.0.1:${address.port}` ||
      req.method !== "GET"
    ) {
      res.writeHead(403).end();
      return;
    }
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    try {
      if (path === "/manifest.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(build.manifest));
      } else if (path === "/frame") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader(
          "content-security-policy",
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts",
        );
        res.end(
          `<!doctype html><meta charset="utf-8"><script>${build.bundle.replace(/<\/script/gi, "<\\/script")}</script>`,
        );
      } else if (files.has(path)) {
        const [type, file] = files.get(path);
        res.setHeader("content-type", type);
        res.end(await readFile(file));
      } else {
        res.writeHead(404).end();
      }
    } catch {
      res.writeHead(500).end("Preview failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
