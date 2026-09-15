import { beforeEach, expect, test, vi } from "vitest";
import {
  assertSessionScope,
  captureSessionScope,
  changeSession,
  identifySession,
  onSessionReset,
  sessionGeneration,
  sessionIdentity,
  sessionSignal,
} from "./session-lifecycle";

beforeEach(() => {
  changeSession(null);
  localStorage.clear();
  changeSession("a");
  identifySession("account-a");
});
test("external credentials abort/reset once, hide unverified identity, and fence old work before storage events arrive", () => {
  const scope = captureSessionScope();
  const signal = sessionSignal();
  const reset = vi.fn();
  const stop = onSessionReset(reset);
  try {
    localStorage.setItem("wiseroutine.session", "b");
    localStorage.setItem("wiseroutine.identity", "account-b");
    expect(() => assertSessionScope(scope)).toThrow("session changed");
    expect(signal.aborted).toBe(true);
    expect(sessionIdentity()).toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "wiseroutine.session" }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
    identifySession("account-b");
    expect(sessionIdentity()).toBe("account-b");
  } finally {
    stop();
  }
});
test("another tab clearing storage invalidates this session without a request or focus", () => {
  const generation = sessionGeneration();
  const signal = sessionSignal();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(signal.aborted).toBe(true);
  expect(sessionGeneration()).toBeGreaterThan(generation);
  expect(sessionIdentity()).toBeNull();
});
test("parallel bootstrap requests may identify the same token without invalidating each other", () => {
  changeSession("fresh-token");
  const scope = captureSessionScope();
  expect(scope.identity).toBeNull();
  identifySession("same-user");
  expect(() => assertSessionScope(scope)).not.toThrow();
});

test("unrelated preferences do not reset a live session", () => {
  const generation = sessionGeneration();
  localStorage.setItem("wr.density", "compact");
  window.dispatchEvent(new StorageEvent("storage", { key: "wr.density" }));
  expect(sessionGeneration()).toBe(generation);
});
