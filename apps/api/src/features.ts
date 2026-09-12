import {
  CORE_FEATURES,
  FEATURE_CONFIG_KEY,
  type Feature,
  type FeatureFlags,
  featureUserKey,
  parseFeatureOverrides,
  resolveFeatures,
} from "@wiseroutine/plans/features";
import { HTTPException } from "hono/http-exception";
import type { Ctx } from "./context";

/** The same reader is usable by requests and queue consumers. KV is eventually
 * consistent: this is a release control, not an instantaneous security revocation. */
export async function readFeatures(
  config: KVNamespace,
  userId: string,
): Promise<FeatureFlags> {
  try {
    const [global, account] = await Promise.all([
      config.get(FEATURE_CONFIG_KEY),
      config.get(featureUserKey(userId)),
    ]);
    return resolveFeatures(
      global === null ? {} : parseFeatureOverrides(JSON.parse(global)),
      account === null ? {} : parseFeatureOverrides(JSON.parse(account)),
    );
  } catch {
    console.error(
      "Release configuration unavailable or invalid; future features disabled",
    );
    return CORE_FEATURES;
  }
}

export function requireFeature(c: Ctx, key: Feature): void {
  if (!c.get("features")[key])
    throw new HTTPException(404, {
      res: Response.json(
        {
          error: "feature_unavailable",
          feature: key,
          message: "This feature is not available for this account.",
        },
        { status: 404, headers: { "cache-control": "no-store" } },
      ),
    });
}
