import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
export const contractURL = new URL(
  "../dist/index.js",
  import.meta.resolve("@wiseroutine/addons"),
);
export const contract = await import(contractURL.href);
const schema = JSON.parse(
  await readFile(new URL("../manifest.schema.json", contractURL), "utf8"),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("wr-origin", contract.isPlainHttpsOrigin);
const schemaCheck = ajv.compile(schema);
export async function readBounded(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`${path}: expected a regular file`);
  if (info.size > limit) throw new Error(`${path}: exceeds ${limit} bytes`);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error(`${path}: exceeds ${limit} bytes`);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
export function validateManifest(raw, community = true) {
  if (!schemaCheck(raw)) throw new Error(ajv.errorsText(schemaCheck.errors));
  const manifest = contract.parseManifest(raw);
  if (!manifest)
    throw new Error(
      "Manifest violates API-1 semantic rules (keys, defaults, capabilities or bounds)",
    );
  if (community && !contract.communityManifestAllowed(manifest))
    throw new Error(
      "Not eligible for the community preview: reserved ID, secrets or network/background capabilities",
    );
  return manifest;
}
export async function validateDirectory(directory, { community = true } = {}) {
  const manifest = validateManifest(
    JSON.parse(
      await readBounded(
        resolve(directory, "manifest.json"),
        contract.MAX_MANIFEST_BYTES,
      ),
    ),
    community,
  );
  const bundle = await readBounded(
    resolve(directory, "dist/addon.js"),
    contract.MAX_BUNDLE_BYTES,
  );
  if (!bundle.trim()) throw new Error("Empty addon bundle");
  return {
    manifest,
    bundle,
    bundleHash: createHash("sha256").update(bundle).digest("hex"),
  };
}
export function releasePayload(build, submission) {
  if (
    typeof submission.privacy !== "string" ||
    !submission.privacy.trim() ||
    submission.privacy.length > 4000 ||
    typeof submission.support !== "string" ||
    !/^https:\/\//.test(submission.support)
  )
    throw new Error(
      "Submission needs a privacy explanation and HTTPS support URL",
    );
  const payload = {
    format: 1,
    id: build.manifest.id,
    version: build.manifest.version,
    manifest: build.manifest,
    bundleHash: build.bundleHash,
    author: submission.author,
    license: submission.license,
    source: submission.source,
  };
  // Shape validation only. The real approval signature is produced separately.
  if (
    !contract.parseRelease({
      payload,
      keyId: "shape-check",
      signature: `${"A".repeat(86)}==`,
    })
  )
    throw new Error(
      "Invalid author, license or immutable GitHub source commit",
    );
  return payload;
}
