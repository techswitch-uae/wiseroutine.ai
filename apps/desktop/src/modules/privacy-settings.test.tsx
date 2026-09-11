import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../lib/api";
import { PrivacySettings } from "./privacy-settings";

afterEach(() => vi.restoreAllMocks());
test("privacy commits only its own preference, independently of day-hour drafts", async () => {
  const update = vi.spyOn(api, "updateSettings").mockResolvedValue(undefined);
  const saved = vi.fn();
  render(<PrivacySettings storeDetails onSaved={saved} />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Store meeting details" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(false));
  expect(update).toHaveBeenCalledWith({ storeEventTitles: false });
});
test("a failed privacy update is visible and is not presented as a confirmed save", async () => {
  vi.spyOn(api, "updateSettings").mockRejectedValue(new Error("offline"));
  const saved = vi.fn();
  render(<PrivacySettings storeDetails onSaved={saved} />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Store meeting details" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't confirm",
  );
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
});
