import { describe, expect, test } from "vitest";
import {
  addonReleased,
  CORE_FEATURES,
  FEATURE_KEYS,
  parseFeatureOverrides,
  releasedWidgets,
  resolveFeatures,
} from "./features";

describe("release availability", () => {
  test("every post-launch feature defaults off", () => {
    expect(Object.keys(CORE_FEATURES)).toHaveLength(FEATURE_KEYS.length);
    expect(
      Object.values(resolveFeatures()).every((value) => value === false),
    ).toBe(true);
    expect(Object.isFrozen(CORE_FEATURES)).toBe(true);
  });
  test("account overrides are independent and explicit false wins", () => {
    expect(
      resolveFeatures({ guided_sessions: true }, { guided_sessions: false })
        .guided_sessions,
    ).toBe(false);
    expect(resolveFeatures({}, { guided_sessions: true }).guided_sessions).toBe(
      true,
    );
    expect(resolveFeatures().guided_sessions).toBe(false);
  });
  test("dependencies fail closed rather than implicitly enabling another release", () => {
    expect(resolveFeatures({ capture_files: true }).capture_files).toBe(false);
    const flags = resolveFeatures({
      inbox: true,
      quick_capture: true,
      capture_files: true,
    });
    expect(flags.capture_files).toBe(true);
    expect(flags.community_addons).toBe(false);
    expect(resolveFeatures(flags, { inbox: false }).capture_files).toBe(false);
  });
  test("weekly planning requires both planning controls and week visibility", () => {
    expect(
      resolveFeatures({ weekly_planning: true, week_view: true })
        .weekly_planning,
    ).toBe(false);
    expect(
      resolveFeatures({
        weekly_planning: true,
        week_view: true,
        day_view_options: true,
        advanced_scheduling: true,
      }).weekly_planning,
    ).toBe(true);
  });
  test.each([
    null,
    [],
    true,
    "true",
    { guided_sessions: "true" },
    { typo: true },
    { guided_sessions: 1 },
  ])("rejects unsafe configuration %j", (value) => {
    expect(() => parseFeatureOverrides(value)).toThrow();
  });
  test("bundled sessions, tasks and insights do not require the community milestone", () => {
    const flags = resolveFeatures({ guided_sessions: true });
    expect(addonReleased(flags, "wiseroutine.breathing")).toBe(true);
    expect(addonReleased(flags, "wiseroutine.todos")).toBe(false);
    expect(addonReleased(flags, "wiseroutine.day-so-far")).toBe(false);
    expect(addonReleased(flags, "acme.fitness")).toBe(false);
    expect(
      addonReleased(
        resolveFeatures({ community_addons: true }),
        "wiseroutine.breathing",
      ),
    ).toBe(false);
  });
  test("offline/legacy widget lists cannot expose hidden insights", () => {
    expect(
      releasedWidgets(CORE_FEATURES, [
        "up_next",
        "missed_today",
        "today_so_far",
        "sitting_streak",
        "acme.fitness/card",
      ]),
    ).toEqual(["up_next", "missed_today"]);
  });
});
