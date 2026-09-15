// biome-ignore-all lint/style/noNonNullAssertion: Synthetic manifests and fixed grant fixtures are required by these tests.
import { describe, expect, test } from "vitest";
import {
  type ApprovedRelease,
  canonicalJSON,
  parseManifest,
  parseRelease,
  type ReleaseCatalog,
  ungranted,
  validateCatalog,
  verifyRelease,
} from "./index";

async function signed() {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", key.publicKey);
  const payload: ApprovedRelease["payload"] = {
    format: 1,
    id: "example.hello",
    version: "1.0.0",
    manifest: parseManifest({
      id: "example.hello",
      name: "Hello",
      version: "1.0.0",
      description: "Example",
      capabilities: [],
    })!,
    bundleHash: "a".repeat(64),
    author: "Example",
    license: "MIT",
    source: {
      repository: "https://github.com/example/hello",
      commit: "b".repeat(40),
    },
  };
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key.privateKey,
      new TextEncoder().encode(canonicalJSON(payload)),
    ),
  );
  return {
    release: {
      payload,
      keyId: "test",
      signature: btoa(String.fromCharCode(...signature)),
    },
    keys: { test: publicKey },
  };
}
describe("release identities and approval", () => {
  test("verifies immutable signed metadata, never an artifact-supplied trust key", async () => {
    const { release, keys } = await signed();
    expect(await verifyRelease(release, keys)).toBe(true);
    expect(await verifyRelease(release, {})).toBe(false);
    for (const field of [
      "id",
      "version",
      "bundleHash",
      "author",
      "license",
    ] as const) {
      const changed = structuredClone(release);
      (changed.payload as unknown as Record<string, unknown>)[field] =
        "tampered";
      expect(await verifyRelease(changed, keys)).toBe(false);
    }
    const changed = structuredClone(release);
    changed.payload.manifest.capabilities = [
      ...changed.payload.manifest.capabilities,
      { kind: "write:todos" },
    ];
    expect(await verifyRelease(changed, keys)).toBe(false);
    expect(
      await verifyRelease(
        { ...release, signature: `${"A".repeat(86)}==` },
        keys,
      ),
    ).toBe(false);
  });
  test("requires retained versions and forbids replacing an already approved identity", async () => {
    const { release, keys } = await signed();
    const catalog: ReleaseCatalog = {
      format: 1,
      releases: [release],
      current: { [release.payload.id]: release.payload.version },
      revoked: [],
    };
    expect(await validateCatalog(catalog, keys)).toBe(catalog);
    await expect(
      validateCatalog({ ...catalog, releases: [release, release] }, keys),
    ).rejects.toThrow("Duplicate");
    await expect(
      validateCatalog({ ...catalog, current: { "missing.id": "1.0.0" } }, keys),
    ).rejects.toThrow("Missing");
    await expect(
      validateCatalog({ ...catalog, releases: [], current: {} }, keys, catalog),
    ).rejects.toThrow("removed or replaced");
    await expect(
      validateCatalog(
        { ...catalog, revoked: [release.payload.id] },
        keys,
        catalog,
      ),
    ).resolves.toBeDefined();
  });
  test("the community preview refuses secrets, external authority, broad reads and reserved IDs", async () => {
    const { release } = await signed();
    for (const cap of [
      { kind: "net:fetch", origins: ["https://example.com"] },
      { kind: "background:wake" },
      { kind: "read:schedule", scope: "week" },
    ]) {
      const bad = structuredClone(release);
      bad.payload.manifest.capabilities = [cap as never];
      expect(parseRelease(bad)).toBeNull();
    }
    const bad = structuredClone(release);
    bad.payload.id = bad.payload.manifest.id = "wiseroutine.fake";
    expect(parseRelease(bad)).toBeNull();
  });
});
test("auth routing belongs in permission differences", () => {
  const old = [
    {
      kind: "net:fetch" as const,
      origins: ["https://example.com"],
      auth: { secret: "key", header: "Authorization", prefix: "Bearer " },
    },
  ];
  expect(
    ungranted(
      [{ ...old[0]!, auth: { ...old[0]!.auth, header: "authorization" } }],
      old,
    ),
  ).toEqual([]);
  for (const auth of [
    { secret: "other", header: "Authorization", prefix: "Bearer " },
    { secret: "key", header: "X-Key", prefix: "Bearer " },
    { secret: "key", header: "Authorization", prefix: "Token " },
  ])
    expect(ungranted([{ ...old[0]!, auth }], old)).toHaveLength(1);
});
test("manifest rejects prototype setting keys, duplicate contributions, nonfinite defaults and excessive contributions", () => {
  const base = {
    id: "example.hello",
    name: "Hello",
    version: "1.0.0",
    description: "Example",
    capabilities: [{ kind: "ui:widget" }],
  };
  expect(
    parseManifest({
      ...base,
      widgets: [
        { key: "a", name: "A" },
        { key: "a", name: "Again" },
      ],
    }),
  ).toBeNull();
  expect(
    parseManifest({
      ...base,
      widgets: Array.from({ length: 5 }, (_, i) => ({
        key: `a${i}`,
        name: "A",
      })),
    }),
  ).toBeNull();
  for (const key of ["__proto__", "constructor", "prototype"])
    expect(
      parseManifest({
        ...base,
        settings: [{ key, label: "X", type: "text", default: "" }],
      }),
    ).toBeNull();
  expect(
    parseManifest({
      ...base,
      settings: [
        { key: "x", label: "X", type: "number", default: 1, max: NaN },
      ],
    }),
  ).toBeNull();
});
