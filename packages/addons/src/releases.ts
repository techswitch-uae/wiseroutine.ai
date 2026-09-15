import {
  type AddonManifest,
  isReservedId,
  parseManifest,
  SEMVER,
} from "./manifest.js";

export interface ReleasePayload {
  format: 1;
  id: string;
  version: string;
  manifest: AddonManifest;
  bundleHash: string;
  author: string;
  license: "MIT" | "Apache-2.0" | "BSD-2-Clause" | "BSD-3-Clause" | "ISC";
  source: { repository: string; commit: string };
}
export interface ApprovedRelease {
  payload: ReleasePayload;
  keyId: string;
  signature: string;
}
export type ApprovalKeys = Record<string, JsonWebKey>;
export interface ReleaseCatalog {
  format: 1;
  releases: ApprovedRelease[];
  current: Record<string, string>;
  revoked: string[];
}
/** Promotion gate. Retained IDs/versions are immutable, even after revocation. */
export async function validateCatalog(
  raw: unknown,
  keys: ApprovalKeys,
  baseline?: ReleaseCatalog,
): Promise<ReleaseCatalog> {
  const catalog = raw as ReleaseCatalog;
  if (
    catalog?.format !== 1 ||
    !Array.isArray(catalog.releases) ||
    catalog.releases.length > 2000 ||
    !catalog.current ||
    Array.isArray(catalog.current) ||
    typeof catalog.current !== "object" ||
    !Array.isArray(catalog.revoked) ||
    !catalog.revoked.every((id) => typeof id === "string")
  )
    throw new Error("Invalid catalog");
  const identities = new Map<string, ApprovedRelease>();
  for (const release of catalog.releases) {
    if (!(await verifyRelease(release, keys)))
      throw new Error("Untrusted or invalid release");
    const id = `${release.payload.id}@${release.payload.version}`;
    if (identities.has(id)) throw new Error(`Duplicate release: ${id}`);
    identities.set(id, release);
  }
  for (const [id, version] of Object.entries(catalog.current)) {
    if (!identities.has(`${id}@${version}`))
      throw new Error(`Missing current release: ${id}@${version}`);
  }
  for (const release of baseline?.releases ?? []) {
    const id = `${release.payload.id}@${release.payload.version}`;
    if (canonicalJSON(identities.get(id) ?? null) !== canonicalJSON(release))
      throw new Error(
        `An approved release cannot be removed or replaced: ${id}`,
      );
  }
  return catalog;
}
export const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
/** Stable signed bytes, independent of JSON key order. No non-JSON values. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJSON((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  throw new Error("Not canonical JSON");
}
/** Deliberately small launch surface: no third-party network/credential integrations yet. */
export function communityManifestAllowed(manifest: AddonManifest): boolean {
  return (
    !isReservedId(manifest.id) &&
    manifest.id !== "wiseroutine" &&
    !manifest.settings.some((field) => field.type === "secret") &&
    manifest.capabilities.every(
      (cap) =>
        !["net:fetch", "ui:embed", "open:external", "background:wake"].includes(
          cap.kind,
        ) &&
        (cap.kind !== "read:schedule" || cap.scope === "today"),
    )
  );
}
export function parseRelease(raw: unknown): ApprovedRelease | null {
  try {
    if (
      canonicalJSON(raw).length > 96 * 1024 ||
      !raw ||
      typeof raw !== "object"
    )
      return null;
    const envelope = raw as ApprovedRelease;
    const p = envelope.payload;
    if (
      p?.format !== 1 ||
      typeof p.id !== "string" ||
      typeof p.version !== "string" ||
      !SEMVER.test(p.version) ||
      !isDigest(p.bundleHash)
    )
      return null;
    const manifest = parseManifest(p.manifest);
    if (
      !manifest ||
      !communityManifestAllowed(manifest) ||
      manifest.id !== p.id ||
      manifest.version !== p.version
    )
      return null;
    if (
      typeof p.author !== "string" ||
      !p.author.trim() ||
      p.author.length > 100
    )
      return null;
    if (
      !["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(
        p.license,
      )
    )
      return null;
    if (
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(p.source?.repository) ||
      !/^[a-f0-9]{40}$/.test(p.source?.commit)
    )
      return null;
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(envelope.keyId) ||
      !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
    )
      return null;
    return envelope;
  } catch {
    return null;
  }
}
export async function verifyRelease(
  raw: unknown,
  keys: ApprovalKeys,
): Promise<boolean> {
  const release = parseRelease(raw);
  if (!release || !Object.hasOwn(keys, release.keyId)) return false;
  const publicKey = keys[release.keyId];
  if (!publicKey) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signature = Uint8Array.from(atob(release.signature), (char) =>
      char.charCodeAt(0),
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      new TextEncoder().encode(canonicalJSON(release.payload)),
    );
  } catch {
    return false;
  }
}
