import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getDayRange, setDayRange, useDayRange } from "./day-range";
import {
  accountStorageKey,
  changeSession,
  identifySession,
} from "./session-lifecycle";

const KEY = "wiseroutine.day.range";
beforeEach(() => {
  changeSession(null);
  localStorage.clear();
  changeSession("range-token");
  identifySession("account-a");
});
afterEach(() => vi.restoreAllMocks());

test("a first visit leaves the existing default and storage untouched", () => {
  expect(getDayRange()).toBeNull();
  expect(localStorage.getItem(accountStorageKey(KEY))).toBeNull();
});

test.each(["working", "full", "custom"])(
  "remembers %s across remounts and a new session for the same account",
  (choice) => {
    const first = renderHook(useDayRange);
    act(() => setDayRange(choice));
    expect(first.result.current).toBe(choice);
    expect(localStorage.getItem(accountStorageKey(KEY))).toBe(choice);
    first.unmount();
    const second = renderHook(useDayRange);
    expect(second.result.current).toBe(choice);
    second.unmount();
    changeSession("new-token");
    identifySession("account-a");
    expect(getDayRange()).toBe(choice);
  },
);

test("an account change updates a mounted reader without inheriting another account's choice", () => {
  const view = renderHook(useDayRange);
  act(() => setDayRange("full"));
  act(() => changeSession("other-token"));
  expect(view.result.current).toBeNull();
  act(() => identifySession("account-b"));
  expect(view.result.current).toBeNull();
  act(() => setDayRange("working"));
  expect(view.result.current).toBe("working");
  act(() => {
    changeSession("return-token");
    identifySession("account-a");
  });
  expect(view.result.current).toBe("full");
});

test("identity arriving after mount loads that account's saved view", () => {
  localStorage.setItem(accountStorageKey(KEY), "full");
  changeSession("resolving-token");
  const view = renderHook(useDayRange);
  expect(view.result.current).toBeNull();
  act(() => identifySession("account-a"));
  expect(view.result.current).toBe("full");
});

test.each(["", "FULL", "null", "{}", "unknown"])(
  "invalid stored view %j safely uses the default",
  (value) => {
    localStorage.setItem(accountStorageKey(KEY), value);
    expect(getDayRange()).toBeNull();
    setDayRange("full");
    setDayRange(value);
    expect(getDayRange()).toBe("full");
  },
);

test("choosing a default in Settings can clear the local override", () => {
  setDayRange("full");
  setDayRange(null);
  expect(getDayRange()).toBeNull();
  expect(localStorage.getItem(accountStorageKey(KEY))).toBeNull();
});

test("blocked writes still keep the choice across navigation in memory", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("QuotaExceededError");
  });
  expect(() => setDayRange("full")).not.toThrow();
  const view = renderHook(useDayRange);
  expect(view.result.current).toBe("full");
});

test("blocked preference reads fall back without crashing", () => {
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (key.endsWith(KEY)) throw new DOMException("SecurityError");
    return get.call(this, key);
  });
  expect(getDayRange()).toBeNull();
});
