import { act, render, screen } from "@testing-library/react";
import { CORE_FEATURES } from "@wiseroutine/plans/features";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import {
  FEATURE_LEASE_MS,
  featureSnapshot,
  loadFeatures,
  useFeatures,
  watchFeatures,
} from "./features";
import { changeSession } from "./session-lifecycle";

vi.mock("./api", () => ({ api: { features: vi.fn() } }));
beforeEach(() => {
  changeSession(null);
  changeSession("feature-test-token");
  vi.mocked(api.features).mockReset();
});
afterEach(() => {
  changeSession(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a new session is core-only; local browser values cannot unlock a release", () => {
  localStorage.setItem("features", JSON.stringify({ guided_sessions: true }));
  expect(featureSnapshot()).toEqual(CORE_FEATURES);
});
test("accepts only server booleans, resolves dependencies, and publishes to mounted consumers", async () => {
  const View = () =>
    createElement("p", null, useFeatures().guided_sessions ? "Guided" : "Core");
  render(createElement(View));
  expect(screen.getByText("Core")).toBeInTheDocument();
  vi.mocked(api.features).mockResolvedValue({
    features: { guided_sessions: true, quick_capture: true },
  });
  // biome-ignore lint/nursery/useAwaitThenable: React act returns a custom thenable that must be awaited.
  await act(async () => {
    await loadFeatures();
  });
  expect(screen.getByText("Guided")).toBeInTheDocument();
  expect(featureSnapshot().quick_capture).toBe(false);
});
test("a rollback, malformed snapshot or network failure hides future features", async () => {
  vi.mocked(api.features).mockResolvedValue({
    features: { guided_sessions: true },
  });
  await loadFeatures();
  expect(featureSnapshot().guided_sessions).toBe(true);
  vi.mocked(api.features).mockResolvedValue({
    features: { guided_sessions: "true" },
  });
  await loadFeatures();
  expect(featureSnapshot()).toEqual(CORE_FEATURES);
  vi.mocked(api.features).mockRejectedValue(new Error("offline"));
  await loadFeatures();
  expect(featureSnapshot()).toEqual(CORE_FEATURES);
});
test("responses from another account and older requests cannot restore access", async () => {
  let finish!: (value: { features: unknown }) => void;
  vi.mocked(api.features).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = loadFeatures();
  await vi.waitFor(() => expect(api.features).toHaveBeenCalled());
  changeSession("other-token");
  finish({ features: { guided_sessions: true } });
  await pending;
  expect(featureSnapshot()).toEqual(CORE_FEATURES);
  vi.mocked(api.features).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const older = loadFeatures();
  await vi.waitFor(() => expect(api.features).toHaveBeenCalledTimes(2));
  vi.mocked(api.features).mockResolvedValue({ features: {} });
  await loadFeatures();
  finish({ features: { guided_sessions: true } });
  await older;
  expect(featureSnapshot()).toEqual(CORE_FEATURES);
});
test("offline drafts retain only a bounded last-verified lease; failures cannot renew it", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  vi.mocked(api.features).mockResolvedValue({
    features: { inbox: true, quick_capture: true },
  });
  await loadFeatures();
  vi.mocked(api.features).mockRejectedValue(
    Object.assign(new Error("offline"), { name: "OfflineError" }),
  );
  clock.mockReturnValue(FEATURE_LEASE_MS - 1);
  await loadFeatures();
  expect(featureSnapshot().quick_capture).toBe(true);
  clock.mockReturnValue(FEATURE_LEASE_MS + 1);
  await loadFeatures();
  expect(featureSnapshot()).toEqual(CORE_FEATURES);
});

test("focus and polling refresh; teardown removes handlers and stale authority", async () => {
  vi.mocked(api.features).mockResolvedValue({ features: {} });
  const stop = watchFeatures();
  await vi.waitFor(() => expect(api.features).toHaveBeenCalledTimes(1));
  globalThis.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(api.features).toHaveBeenCalledTimes(2));
  stop();
  globalThis.dispatchEvent(new Event("focus"));
  expect(api.features).toHaveBeenCalledTimes(2);
});
