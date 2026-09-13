import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { beginConnect } from "../lib/calendar-connect";
import { SetupRail } from "./setup-rail";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../lib/calendar-connect", () => ({ beginConnect: vi.fn() }));
vi.mock("../lib/api", () => ({
  api: {
    calendars: vi.fn(async () => ({ connections: [], calendars: [] })),
    activities: vi.fn(async () => []),
  },
}));
vi.mock("../lib/alerts", () => ({
  alertsAvailable: () => false,
  alertPermissionGranted: vi.fn(),
  ensureAlertPermission: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(beginConnect).mockReset();
});

test("failed browser handoff leaves setup open with an actionable error; retry can succeed", async () => {
  vi.mocked(beginConnect)
    .mockResolvedValueOnce(
      "Couldn't open your browser. Allow pop-ups and try again.",
    )
    .mockResolvedValueOnce(null);
  render(<SetupRail />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
  const dialog = screen.getByRole("dialog", { name: "Connect a calendar" });
  const connect = within(dialog).getAllByRole("button", { name: "Connect" })[0];
  if (!connect) throw new Error("Missing provider connection button");
  fireEvent.click(connect);
  expect(await screen.findByRole("alert")).toHaveTextContent("Allow pop-ups");
  expect(dialog).toBeVisible();
  fireEvent.click(connect);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(beginConnect).toHaveBeenCalledTimes(2);
});
