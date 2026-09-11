import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function releaseConfig(env, config) {
  const url = new URL(env.VITE_API_URL || "http://localhost");
  const allowed = config.app.security.csp["connect-src"].split(/\s+/);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !allowed.includes(url.origin)
  ) {
    throw new Error(
      "VITE_API_URL must be an explicit HTTPS API origin allowed by the desktop CSP",
    );
  }
  const key = env.TAURI_SIGNING_PUBLIC_KEY?.trim();
  if (!key || !env.TAURI_SIGNING_PRIVATE_KEY?.trim())
    throw new Error("Updater public and private signing keys are required");
  // Tauri's public key is a base64-encoded minisign public-key document.
  const document = Buffer.from(key, "base64").toString("utf8");
  const lines = document.trim().split(/\r?\n/);
  const bytes = Buffer.from(lines[1] ?? "", "base64");
  if (!lines[0].startsWith("untrusted comment:") || lines.length !== 2 || bytes.length !== 42 || bytes.subarray(0, 2).toString() !== "Ed")
    throw new Error("Invalid updater public-key document");
  return { plugins: { updater: { pubkey: key } } };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(import.meta.dirname, "..");
  const config = JSON.parse(
    readFileSync(
      resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
      "utf8",
    ),
  );
  const overlay = releaseConfig(process.env, config);
  if (!process.argv.includes("--check"))
    writeFileSync(
      resolve(root, "apps/desktop/src-tauri/tauri.release.generated.json"),
      `${JSON.stringify(overlay, null, 2)}\n`,
    );
}
