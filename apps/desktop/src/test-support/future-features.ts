import { vi } from "vitest";

/** Explicit opt-in for existing milestone component suites. Core/store/rollout
 * tests do not import this helper and exercise the real default-off state. */
vi.mock("../lib/features", async () => {
  const { FEATURE_KEYS, resolveFeatures } = await import(
    "@wiseroutine/plans/features"
  );
  const flags = resolveFeatures(
    Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])),
  );
  return {
    featureSnapshot: () => flags,
    useFeatures: () => flags,
    subscribeFeatures: () => () => undefined,
  };
});
