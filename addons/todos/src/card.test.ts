import type { Todo } from "@wiseroutine/addon-sdk";
import { describe, expect, it } from "vitest";
import { metaOf, parseAdd, slotLabelOf } from "./card";

const NOON = Date.UTC(2026, 8, 1, 12, 0);

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: "t",
  title: "Physio",
  minutes: 20,
  needsFocus: false,
  fitsAt: NOON,
  ...over,
});

describe("what a row says", () => {
  it("names the length and where it would land", () => {
    expect(metaOf(todo(), "UTC")).toBe("20 min · fits 12:00");
    expect(slotLabelOf(todo(), "UTC")).toBe("Slot 12:00");
  });

  it("says so when today has no gap for it, and offers no button", () => {
    expect(metaOf(todo({ minutes: null, fitsAt: null }), "UTC")).toBe(
      "no length · no gap today",
    );
    expect(slotLabelOf(todo({ fitsAt: null }), "UTC")).toBeNull();
  });

  it("reads the clock in the user's zone, not the frame's", () => {
    expect(metaOf(todo(), "Asia/Dubai")).toBe("20 min · fits 16:00");
  });
});

describe("what was typed", () => {
  it("takes a trailing length off the title", () => {
    expect(parseAdd("Reply to Anders 20m")).toEqual({
      title: "Reply to Anders",
      minutes: 20,
    });
    expect(parseAdd("Physio 15 min")).toEqual({ title: "Physio", minutes: 15 });
  });

  it("leaves a title that only looks like it has one", () => {
    expect(parseAdd("Read chapter 3")).toEqual({
      title: "Read chapter 3",
      minutes: null,
    });
    expect(parseAdd("  ")).toBeNull();
  });
});
