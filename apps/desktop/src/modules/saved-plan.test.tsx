import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { TodayResponse } from "../lib/api";
import { publishPlan } from "../lib/plan-store";
import { SavedPlan } from "./saved-plan";

let pending = 0;
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { pendingCount: () => pending },
}));

const day = (over: Record<string, unknown> = {}): TodayResponse =>
  ({
    date: { year: 2026, month: 8, day: 11 },
    timeZone: "UTC",
    slots: [],
    meetings: [],
    ...over,
  }) as unknown as TodayResponse;

afterEach(() => {
  publishPlan(null);
  pending = 0;
});

test("says when the plan was saved, and what is waiting to sync", () => {
  pending = 2;
  publishPlan(day({ stale: true, cachedAt: Date.UTC(2026, 7, 11, 9, 5) }));
  render(<SavedPlan />);
  expect(screen.getByRole("status")).toHaveTextContent(
    /Showing the plan saved at \d\d:\d\d\. 2 changes will sync when you reconnect\./,
  );
});

test("draws nothing for a plan that came from the server", () => {
  publishPlan(day({ stale: false, cachedAt: Date.UTC(2026, 7, 11, 9, 5) }));
  const { container } = render(<SavedPlan />);
  expect(container).toBeEmptyDOMElement();
});
