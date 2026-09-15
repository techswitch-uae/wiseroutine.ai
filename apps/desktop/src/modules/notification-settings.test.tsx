import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  alertPermissionGranted,
  alertsAvailable,
  ensureAlertPermission,
} from "../lib/alerts";
import { NotificationSettings } from "./notification-settings";

vi.mock("../lib/alerts", () => ({
  alertsAvailable: vi.fn(),
  alertPermissionGranted: vi.fn(),
  ensureAlertPermission: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(alertsAvailable).mockReturnValue(true);
  vi.mocked(alertPermissionGranted).mockReset().mockResolvedValue(false);
  vi.mocked(ensureAlertPermission).mockReset().mockResolvedValue(false);
});
test("browser never offers native permissions or invokes a plugin", () => {
  vi.mocked(alertsAvailable).mockReturnValue(false);
  render(<NotificationSettings />);
  expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  expect(alertPermissionGranted).not.toHaveBeenCalled();
  expect(ensureAlertPermission).not.toHaveBeenCalled();
});
test("permission is never prompted by rendering; denial is recoverable in Settings", async () => {
  render(<NotificationSettings />);
  const allow = await screen.findByRole("button", {
    name: "Allow notifications",
  });
  expect(ensureAlertPermission).not.toHaveBeenCalled();
  fireEvent.click(allow);
  await waitFor(() => expect(allow).not.toBeDisabled());
  expect(screen.getByRole("status")).toHaveTextContent(
    "system notification settings",
  );
  vi.mocked(alertPermissionGranted).mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Notifications are allowed",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Allow notifications" }),
  ).toBeNull();
});
test("returning from system settings re-reads permission, including revocation", async () => {
  vi.mocked(alertPermissionGranted).mockResolvedValue(true);
  render(<NotificationSettings />);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Notifications are allowed",
    ),
  );
  vi.mocked(alertPermissionGranted).mockResolvedValue(false);
  fireEvent(window, new Event("focus"));
  expect(
    await screen.findByRole("button", { name: "Allow notifications" }),
  ).toBeVisible();
});
