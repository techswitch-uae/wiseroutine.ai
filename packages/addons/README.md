# @wiseroutine/addons

MIT-licensed API-1 manifest types, runtime parser, capability comparison, release verification and JSON Schema. No private app/backend dependency.

```ts
import { parseManifest, ungranted } from "@wiseroutine/addons";
const manifest = parseManifest(JSON.parse(source));
if (!manifest) throw new Error("Invalid or unsupported addon manifest");
const permissionChanges = ungranted(manifest.capabilities, previouslyGranted);
```

The schema is exported as `@wiseroutine/addons/manifest.schema.json`. `wr-addon validate` from `@wiseroutine/addon-tools` runs both JSON Schema and semantic validation. Generic editor schema checks cannot enforce every rule (unique keys, capability/contribution relationships, select defaults, numeric ranges or canonical HTTPS origins). The `wr-origin` format is implemented by `isPlainHttpsOrigin`.

API version is independent of package and addon versions. API-1 manifests use bounded `major.minor.patch` versions with an optional prerelease suffix. IDs are lowercase dot/hyphen-separated names, maximum 64 characters; `wiseroutine` and `wiseroutine.*` are reserved for the application. Keep an ID stable and increment the version for every changed release. Contributions: up to four each of widgets, activity types and Quick Add rows; keys unique within each contribution kind. At most twenty capabilities/settings; secrets only in addon-level settings, never activity configuration. Canvas requests are finite numbers clamped by the host.

`net:fetch` approval includes origin, secret-field name, header (case-insensitive) and prefix. An auth-routing change is a permission change. Removed permissions are not retained during an explicit version change. There is no implicit approval of new permissions.

`ApprovedRelease` signs a canonical JSON payload binding ID, version, complete manifest, SHA-256 digest, author, license and immutable source commit. Signatures are ECDSA P-256/SHA-256, 64-byte IEEE-P1363, base64. `verifyRelease` requires a separately trusted public-key map; keys in a downloaded descriptor are not trust roots. `validateCatalog` rejects duplicate/replaced releases and missing current targets. Hashes/signatures do not prove benign behavior or replace human review.

See `SPEC.md` and `SUBMISSIONS.md` in the standalone kit for the supported launch subset and submission process. The manifest/SDK licenses do not license the main application or grant hosted service entitlements.
