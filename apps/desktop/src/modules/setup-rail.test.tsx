import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { api } from "../lib/api";
import { beginConnect } from "../lib/calendar-connect";
import { accountStorageKey } from "../lib/session-lifecycle";
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
  vi.mocked(api.calendars)
    .mockReset()
    .mockResolvedValue({ connections: [], calendars: [] });
  vi.mocked(api.activities).mockReset().mockResolvedValue([]);
});

test.each(["calendars", "activities"] as const)(
  "failed %s read never completes setup and retry can recover",
  async (failed) => {
    localStorage.setItem(accountStorageKey("wr.setup.hours"), "1");
    vi.mocked(api.calendars).mockResolvedValue({
      connections: [
        {
          id: "connected",
          provider: "google",
          email: "test@example.com",
          status: "active",
        },
      ],
      calendars: [],
    } as Awaited<ReturnType<typeof api.calendars>>);
    vi.mocked(api.activities).mockResolvedValue([{ isActive: true }] as Awaited<
      ReturnType<typeof api.activities>
    >);
    vi.mocked(api[failed]).mockRejectedValueOnce(new Error("offline"));
    render(<SetupRail />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't check your setup",
    );
    expect(localStorage.getItem(accountStorageKey("wr.setup.done"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry setup check" }));
    await waitFor(() =>
      expect(localStorage.getItem(accountStorageKey("wr.setup.done"))).toBe(
        "1",
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

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
