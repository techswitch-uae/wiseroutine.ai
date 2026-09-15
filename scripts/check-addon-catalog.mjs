import { readFile } from "node:fs/promises";
import { contract } from "../packages/addon-tools/lib/validate.mjs";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
try {
  const catalog = await json(
    new URL("../addon-registry/catalog.json", import.meta.url),
  );
  const trust = await json(
    new URL("../addon-registry/trust.json", import.meta.url),
  );
  const baseline = process.argv[2] ? await json(process.argv[2]) : undefined;
  for (const [id, key] of Object.entries(trust)) {
    if (key.d || key.kty !== "EC" || key.crv !== "P-256" || !key.x || !key.y)
      throw new Error(`Not a public P-256 key: ${id}`);
  }
  await contract.validateCatalog(catalog, trust, baseline);
  const history = await json(
    new URL("../addon-registry/bundled-history.json", import.meta.url),
  );
  const identities = new Map();
  for (const raw of history) {
    const manifest = contract.parseManifest(raw);
    if (!manifest) throw new Error("Invalid archived bundled manifest");
    const id = `${manifest.id}@${manifest.version}`;
    if (identities.has(id)) throw new Error(`Duplicate bundled release ${id}`);
    identities.set(id, contract.canonicalJSON(manifest));
  }
  for (const name of [
    "breathing",
    "day-so-far",
    "deep-work",
    "eye-rest",
    "stretch",
    "todos",
  ]) {
    const manifest = contract.parseManifest(
      await json(new URL(`../addons/${name}/manifest.json`, import.meta.url)),
    );
    if (
      !manifest ||
      identities.get(`${manifest.id}@${manifest.version}`) !==
        contract.canonicalJSON(manifest)
    )
      throw new Error(
        `Archive the exact bundled manifest for ${name}; never overwrite an old version`,
      );
  }
  if (process.argv[3])
    for (const raw of await json(process.argv[3])) {
      const manifest = contract.parseManifest(raw);
      if (
        !manifest ||
        identities.get(`${manifest.id}@${manifest.version}`) !==
          contract.canonicalJSON(manifest)
      )
        throw new Error(
          "An archived bundled release cannot be removed or changed",
        );
    }
  console.log(
    `Catalog valid: ${catalog.releases.length} approved community releases. ${Object.keys(trust).length} public approval keys.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
