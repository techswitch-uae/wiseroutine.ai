/** Prune a pnpm v9 lock to public workspace importers and their reachable graph. */
export function addonKitLock(source, workspacePaths) {
  if (source.lockfileVersion !== "9.0")
    throw new Error("Unsupported lockfile format");
  const result = {
    lockfileVersion: source.lockfileVersion,
    settings: source.settings,
    importers: { ".": {} },
    packages: {},
    snapshots: {},
  };
  const queue = [];
  const enqueue = (dependencies) => {
    for (const [name, entry] of Object.entries(dependencies ?? {})) {
      const version = typeof entry === "string" ? entry : entry.version;
      if (version.startsWith("link:")) continue;
      queue.push(
        version.startsWith("npm:") ? version.slice(4) : `${name}@${version}`,
      );
    }
  };
  for (const path of workspacePaths) {
    const importer = source.importers[path];
    if (!importer) throw new Error(`Missing public importer: ${path}`);
    result.importers[path] = importer;
    for (const kind of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ])
      enqueue(importer[kind]);
  }
  while (queue.length) {
    const key = queue.pop();
    if (Object.hasOwn(result.snapshots, key)) continue;
    const snapshot = source.snapshots[key];
    if (!snapshot) throw new Error(`Missing locked dependency: ${key}`);
    const base = key.split("(")[0];
    const metadata = source.packages[base];
    if (!metadata) throw new Error(`Missing package metadata: ${base}`);
    result.packages[base] = metadata;
    result.snapshots[key] = snapshot;
    enqueue(snapshot.dependencies);
    enqueue(snapshot.optionalDependencies);
  }
  return result;
}
