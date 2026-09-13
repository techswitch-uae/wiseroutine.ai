import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../lib/api";
import { PrivacySettings } from "./privacy-settings";

afterEach(() => vi.restoreAllMocks());
const toggle = () =>
  screen.getByRole("switch", { name: "Save meeting details" });

test("the toggle explains removal and commits only the privacy preference", async () => {
  const update = vi.spyOn(api, "updateSettings").mockResolvedValue(undefined);
  const saved = vi.fn();
  render(<PrivacySettings storeDetails onSaved={saved} />);
  expect(toggle()).toBeChecked();
  expect(toggle()).toHaveAccessibleDescription(
    /Turning this off removes saved meeting details/,
  );
  expect(screen.getByText(/Busy times stay/)).toBeVisible();
  fireEvent.click(toggle());
  await waitFor(() => expect(saved).toHaveBeenCalledWith(false));
  expect(update).toHaveBeenCalledExactlyOnceWith({ storeEventTitles: false });
});

test("the toggle waits for confirmation and cannot submit twice while saving", async () => {
  let finish: (() => void) | undefined;
  const update = vi.spyOn(api, "updateSettings").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const saved = vi.fn();
  const { rerender } = render(<PrivacySettings storeDetails onSaved={saved} />);
  fireEvent.click(toggle());
  expect(toggle()).toBeDisabled();
  expect(toggle()).toBeChecked();
  fireEvent.click(toggle());
  expect(update).toHaveBeenCalledOnce();
  finish?.();
  await waitFor(() => expect(saved).toHaveBeenCalledWith(false));
  rerender(<PrivacySettings storeDetails={false} onSaved={saved} />);
  expect(toggle()).not.toBeChecked();
  expect(toggle()).toBeEnabled();
});

test("failed removal is visible and leaves the last confirmed toggle state", async () => {
  vi.spyOn(api, "updateSettings").mockRejectedValue(new Error("offline"));
  const saved = vi.fn();
  render(<PrivacySettings storeDetails onSaved={saved} />);
  fireEvent.click(toggle());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't confirm",
  );
  expect(saved).not.toHaveBeenCalled();
  expect(toggle()).toBeChecked();
  expect(toggle()).toBeEnabled();
});

test("switching back on permits details from future syncs", async () => {
  const update = vi.spyOn(api, "updateSettings").mockResolvedValue(undefined);
  const saved = vi.fn();
  render(<PrivacySettings storeDetails={false} onSaved={saved} />);
  expect(screen.getByText(/Only busy times are saved/)).toBeVisible();
  expect(toggle()).toHaveAccessibleDescription(/future calendar syncs/);
  fireEvent.click(toggle());
  await waitFor(() => expect(saved).toHaveBeenCalledWith(true));
  expect(update).toHaveBeenCalledWith({ storeEventTitles: true });
});
