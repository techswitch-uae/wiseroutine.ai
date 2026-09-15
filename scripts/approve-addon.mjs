#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This uncached trusted command runs outside Turbo; never pass approval credentials to builds.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
// Trusted promotion only. NEVER install dependencies or run source from the artifact.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  contract,
  readBounded,
  releasePayload,
  validateManifest,
} from "../packages/addon-tools/lib/validate.mjs";

const [directory, output] = process.argv.slice(2);
try {
  if (
    !directory ||
    !output ||
    !process.env.ADDON_APPROVAL_KEY_FILE ||
    !process.env.ADDON_APPROVAL_KEY_ID
  )
    throw new Error(
      "Usage: ADDON_APPROVAL_KEY_FILE=... ADDON_APPROVAL_KEY_ID=... node scripts/approve-addon.mjs <reviewed-artifact-directory> <new-approval.json>",
    );
  const payload = JSON.parse(
    await readBounded(resolve(directory, "payload.json"), 96 * 1024),
  );
  validateManifest(payload.manifest);
  const manifest = validateManifest(
    JSON.parse(
      await readBounded(resolve(directory, "manifest.json"), 64 * 1024),
    ),
  );
  if (
    contract.canonicalJSON(manifest) !==
    contract.canonicalJSON(payload.manifest)
  )
    throw new Error("Artifact manifest differs from approved payload");
  const bundle = await readBounded(
    resolve(directory, "addon.js"),
    contract.MAX_BUNDLE_BYTES,
  );
  if (createHash("sha256").update(bundle).digest("hex") !== payload.bundleHash)
    throw new Error("Artifact hash mismatch");
  const submission = JSON.parse(
    await readBounded(resolve(directory, "submission.json"), 8192),
  );
  const checked = releasePayload(
    { manifest, bundle, bundleHash: payload.bundleHash },
    submission,
  );
  if (contract.canonicalJSON(checked) !== contract.canonicalJSON(payload))
    throw new Error("Submission and release metadata differ");
  if (!(await readBounded(resolve(directory, "LICENSE"), 128 * 1024)).trim())
    throw new Error("Missing license text");
  const keyId = process.env.ADDON_APPROVAL_KEY_ID;
  if (
    !contract.parseRelease({ payload, keyId, signature: `${"A".repeat(86)}==` })
  )
    throw new Error("Invalid release payload");
  const key = createPrivateKey(
    await readFile(process.env.ADDON_APPROVAL_KEY_FILE),
  );
  const publicKey = createPublicKey(key).export({ format: "jwk" });
  if (publicKey.crv !== "P-256")
    throw new Error("Approval key must be ECDSA P-256");
  const signature = sign(
    "sha256",
    Buffer.from(contract.canonicalJSON(payload)),
    { key, dsaEncoding: "ieee-p1363" },
  ).toString("base64");
  const approval = { payload, keyId, signature };
  if (!(await contract.verifyRelease(approval, { [keyId]: publicKey })))
    throw new Error("Signature self-check failed");
  await writeFile(output, `${JSON.stringify(approval, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(
    `Approved descriptor written to ${output}. No upload, catalog update or npm publication performed.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
