import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { CalendarsResponse } from "../lib/api";
import { ReconnectRail } from "./reconnect-rail";
import { TodayRail } from "./today-rail";

const calendars = vi.fn<() => Promise<CalendarsResponse>>();
const beginConnect = vi.fn(async (_provider: string) => null);

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { calendars: () => calendars() },
}));
vi.mock("../routes/_app.calendars", () => ({
  beginConnect: (provider: string) => beginConnect(provider),
}));
// The rest of the rail only has to be identifiable here, not rendered: each
// one reads a plan, a session and a router this test has no business standing
// up just to prove what sits above them.
vi.mock("./this-slot", () => ({ ThisSlot: () => <div>this slot</div> }));
vi.mock("./setup-rail", () => ({ SetupRail: () => <div>setup</div> }));
vi.mock("./to-place", () => ({ ToPlace: () => <div>to place</div> }));
vi.mock("./dashboard", () => ({ DashboardWidgets: () => <div>widgets</div> }));

const connection = (status: string) => ({
  id: `c-${status}`,
  provider: "google" as const,
  email: "cal@example.com",
  status,
});

test("a dead grant asks to be reconnected", async () => {
  calendars.mockResolvedValue({
    connections: [connection("needs_reauth")],
    calendars: [],
  });

  render(<ReconnectRail />);
  expect(await screen.findByText("cal@example.com")).toBeTruthy();

  // Signing in again is the whole repair, so the button does it rather than
  // sending the user to Calendars to find the same button.
  await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(beginConnect).toHaveBeenCalledWith("google");
});

test("a healthy account draws nothing", async () => {
  calendars.mockResolvedValue({
    connections: [connection("active")],
    calendars: [],
  });

  const { container } = render(<ReconnectRail />);
  await waitFor(() => expect(calendars).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

// Offline is not a revoked grant, and the consent screen would not load for
// someone on a train either.
test("a failed read says nothing", async () => {
  calendars.mockRejectedValue(new Error("offline"));

  const { container } = render(<ReconnectRail />);
  await waitFor(() => expect(calendars).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

test("it stands above everything else in the rail", async () => {
  calendars.mockResolvedValue({
    connections: [connection("needs_reauth")],
    calendars: [],
  });

  const { container } = render(<TodayRail />);
  await screen.findByText("cal@example.com");

  const order = (container.textContent ?? "").indexOf("cal@example.com");
  expect(order).toBeLessThan(
    (container.textContent ?? "").indexOf("this slot"),
  );
});
