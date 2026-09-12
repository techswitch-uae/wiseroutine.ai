/** Release availability, not subscription entitlement. Every future feature is off
 * unless an operator enables it in this environment or for a specific account. */
export const FEATURES = {
  guided_sessions: { milestone: "m1", requires: [] },
  inbox: { milestone: "m2", requires: [] },
  quick_capture: { milestone: "m2", requires: ["inbox"] },
  capture_files: { milestone: "m2", requires: ["quick_capture"] },
  advanced_scheduling: { milestone: "m3", requires: [] },
  larger_routines: { milestone: "m3", requires: [] },
  billing_checkout: { milestone: "m3", requires: [] },
  week_view: { milestone: "m4", requires: ["day_view_options"] },
  month_view: { milestone: "m4", requires: ["week_view"] },
  day_view_options: { milestone: "m4", requires: [] },
  weekly_planning: {
    milestone: "m4",
    requires: ["advanced_scheduling", "week_view"],
  },
  insights: { milestone: "m5", requires: [] },
  dashboard_customization: { milestone: "m5", requires: ["insights"] },
  community_addons: { milestone: "m6", requires: [] },
} as const;

export type Feature = keyof typeof FEATURES;
export type Milestone = (typeof FEATURES)[Feature]["milestone"];
export type FeatureFlags = Readonly<Record<Feature, boolean>>;
export type FeatureOverrides = Partial<Record<Feature, boolean>>;
export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];
export const FEATURE_CONFIG_KEY = "release-features:v1";
export const featureUserKey = (userId: string) =>
  `${FEATURE_CONFIG_KEY}:user:${userId}`;
export const CORE_FEATURES: FeatureFlags = Object.freeze(
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])) as Record<
    Feature,
    boolean
  >,
);

export function isFeature(value: string): value is Feature {
  return Object.hasOwn(FEATURES, value);
}

/** Strict parsing prevents misspellings, truthy strings, arrays and malformed
 * operator configuration from accidentally publishing a feature. */
export function parseFeatureOverrides(value: unknown): FeatureOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Feature flags must be a JSON object of known boolean flags",
    );
  const result: FeatureOverrides = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!isFeature(key) || typeof enabled !== "boolean")
      throw new Error(`Invalid feature flag: ${key}`);
    result[key] = enabled;
  }
  return result;
}

/** Account overrides win (including explicit false); dependencies are ANDed,
 * never auto-enabled by the resolver. The operator CLI can expand them. */
export function resolveFeatures(
  defaults: FeatureOverrides = {},
  account: FeatureOverrides = {},
): FeatureFlags {
  const requested = { ...CORE_FEATURES, ...defaults, ...account };
  const enabled = (key: Feature): boolean =>
    requested[key] === true && FEATURES[key].requires.every(enabled);
  return Object.freeze(
    Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, enabled(key)]),
    ) as Record<Feature, boolean>,
  );
}

/** Shared by the API and desktop: bundled implementation is not synonymous
 * with public availability. Unknown/community addons require M6. */
export function addonReleased(flags: FeatureFlags, id: string): boolean {
  switch (id) {
    case "wiseroutine.breathing":
    case "wiseroutine.stretch":
    case "wiseroutine.eye-rest":
    case "wiseroutine.deep-work":
      return flags.guided_sessions;
    case "wiseroutine.todos":
      return flags.quick_capture;
    case "wiseroutine.day-so-far":
      return flags.insights;
    default:
      return flags.community_addons;
  }
}

/** Rollout filtering supplements (never replaces) plan/widget authorization. */
export function releasedWidgets(
  flags: FeatureFlags,
  keys: readonly string[],
): string[] {
  return keys.filter((key) => {
    if (key === "up_next" || key === "missed_today") return true;
    if (key === "today_so_far") return flags.insights;
    if (key.includes("/")) return addonReleased(flags, key.split("/")[0] ?? "");
    return flags.dashboard_customization;
  });
}
