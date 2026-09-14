import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../lib/api";
import { PrivacySettings } from "./privacy-settings";

afterEach(() => vi.restoreAllMocks());
const details = () =>
  screen.getByRole("radio", { name: /Save meeting details/ });
const busy = () => screen.getByRole("radio", { name: /Busy times only/ });
const update = () => screen.queryByRole("button", { name: /Updat/ });

test("choosing busy-only previews the slot and commits only on Update", async () => {
  const patch = vi.spyOn(api, "updateSettings").mockResolvedValue(undefined);
  const saved = vi.fn();
  render(<PrivacySettings storeDetails onSaved={saved} />);
  expect(details()).toBeChecked();
  expect(screen.getByText("Weekly planning")).toBeVisible();
  expect(update()).toBeNull();

  fireEvent.click(busy());
  expect(screen.getByText("Busy")).toBeVisible();
  expect(screen.getByText(/Busy times stay/)).toBeVisible();
  expect(patch).not.toHaveBeenCalled();

  fireEvent.click(update() as HTMLElement);
  await waitFor(() => expect(saved).toHaveBeenCalledWith(false));
  expect(patch).toHaveBeenCalledExactlyOnceWith({ storeEventTitles: false });
});

test("Cancel puts the saved choice back without a request", () => {
  const patch = vi.spyOn(api, "updateSettings").mockResolvedValue(undefined);
  render(<PrivacySettings storeDetails onSaved={vi.fn()} />);
  fireEvent.click(busy());
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(details()).toBeChecked();
  expect(update()).toBeNull();
  expect(patch).not.toHaveBeenCalled();
});

test("Update waits for confirmation and cannot submit twice while saving", async () => {
  let finish: (() => void) | undefined;
  const patch = vi.spyOn(api, "updateSettings").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const saved = vi.fn();
  const { rerender } = render(<PrivacySettings storeDetails onSaved={saved} />);
  fireEvent.click(busy());
  fireEvent.click(update() as HTMLElement);
  expect(update()).toBeDisabled();
  fireEvent.click(update() as HTMLElement);
  expect(patch).toHaveBeenCalledOnce();
  finish?.();
  await waitFor(() => expect(saved).toHaveBeenCalledWith(false));
  rerender(<PrivacySettings storeDetails={false} onSaved={saved} />);
  expect(busy()).toBeChecked();
  expect(update()).toBeNull();
});

test("a failed update is visible and keeps the draft on screen", async () => {
  vi.spyOn(api, "updateSettings").mockRejectedValue(new Error("offline"));
  const saved = vi.fn();
  render(<PrivacySettings storeDetails onSaved={saved} />);
  fireEvent.click(busy());
  fireEvent.click(update() as HTMLElement);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't confirm",
  );
  expect(saved).not.toHaveBeenCalled();
  expect(busy()).toBeChecked();
  expect(update()).toBeEnabled();
});

test("switching back on explains that details arrive with future syncs", async () => {
  const patch = vi.spyOn(api, "updateSettings").mockResolvedValue(undefined);
  const saved = vi.fn();
  render(<PrivacySettings storeDetails={false} onSaved={saved} />);
  expect(screen.getByText("Busy")).toBeVisible();
  fireEvent.click(details());
  expect(screen.getByText(/next calendar sync/)).toBeVisible();
  fireEvent.click(update() as HTMLElement);
  await waitFor(() => expect(saved).toHaveBeenCalledWith(true));
  expect(patch).toHaveBeenCalledWith({ storeEventTitles: true });
});
