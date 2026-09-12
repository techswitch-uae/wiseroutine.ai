import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ActivityResponse, CaptureInput, TodayResponse } from "../lib/api";
import { readCaptureDraft, saveCaptureDraft } from "../lib/capture-draft";
import { publishPlan, resetPlans } from "../lib/plan-store";
import { changeSession } from "../lib/session-lifecycle";
import { resetTodos } from "../lib/todos";
import { QuickAdd } from "./quick-add";

vi.mock("../lib/capture-draft", () => ({
  readCaptureDraft: vi.fn(async () => null),
  saveCaptureDraft: vi.fn(async () => undefined),
}));
const capture =
  vi.fn<
    (input: CaptureInput) => Promise<{ todoId: string; slotId: string | null }>
  >();
const upload = vi.fn(async () => ({ id: "file", name: "read.pdf", size: 4 }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    activities: async (): Promise<Partial<ActivityResponse>[]> => [
      {
        id: "a1",
        name: "Stretch",
        kind: "recovery",
        isActive: true,
        sessionMinutes: 10,
      },
    ],
    todos: async () => [
      {
        id: "t1",
        title: "Physio exercises",
        minutes: 20,
        needsFocus: false,
        createdAt: 0,
      },
    ],
    scope: async () => ({ days: [] }),
    today: async () => day(),
    capture: (body: CaptureInput) => capture(body),
    uploadCaptureFile: (...args: unknown[]) => upload(...(args as [])),
    discardCaptureFiles: async () => undefined,
  },
}));
const day = (): TodayResponse => {
  const now = Date.now(),
    d = new Date(now);
  return {
    date: {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    },
    timeZone: "UTC",
    dayStart: now - 3600000,
    dayEnd: now + 8 * 3600000,
    range: "full",
    ranges: [],
    slots: [],
    meetings: [],
    outside: { before: [], after: [] },
    syncedAt: null,
    widgets: [],
  };
};
beforeEach(() => {
  vi.mocked(readCaptureDraft).mockResolvedValue(null);
  resetPlans();
  resetTodos();
  publishPlan(day());
  capture.mockReset();
  capture.mockResolvedValue({ todoId: "new", slotId: "slot" });
});
afterEach(() => vi.clearAllMocks());
const open = async (onClose = vi.fn()) => {
  const user = userEvent.setup();
  render(<QuickAdd onClose={onClose} />);
  await screen.findByRole("button", { name: /Physio exercises/ });
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "What to add" })).toHaveFocus(),
  );
  return { user, onClose };
};

test("⌘1 schedules an activity on the grid in one atomic capture", async () => {
  const { user } = await open();
  await user.keyboard("{Meta>}1{/Meta}");
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  expect(capture.mock.calls[0]?.[0]).toMatchObject({
    activityId: "a1",
    title: "Stretch",
    minutes: 10,
  });
  expect((capture.mock.calls[0]?.[0].startsAt ?? 1) % 300000).toBe(0);
});
test("text, Enter, Enter atomically creates and plans a todo", async () => {
  const { user, onClose } = await open();
  await user.keyboard("Reply to Anders{Enter}{Enter}");
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  const body = capture.mock.calls[0]?.[0];
  expect(body).toMatchObject({ title: "Reply to Anders", minutes: 15 });
  expect(body?.startsAt).toBeGreaterThan(Date.now() - 1000);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
test("a waiting todo is scheduled as itself, not duplicated", async () => {
  const { user } = await open();
  await user.keyboard("{Enter}{Enter}");
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  expect(capture.mock.calls[0]?.[0]).toMatchObject({
    todoId: "t1",
    minutes: 20,
  });
});
test("save to inbox works without any installed or serving addon", async () => {
  const { user } = await open();
  await user.keyboard("Read a paper{Control>}{Enter}{/Control}");
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(capture.mock.calls[0]?.[0]).toMatchObject({
    title: "Read a paper",
    fileIds: [],
  });
  expect(capture.mock.calls[0]?.[0]).not.toHaveProperty("startsAt");
});
test("links and multiple file-only captures preserve contents; upload failure keeps the dialog", async () => {
  const { user, onClose } = await open();
  const files = [
    new File(["%PDF"], "paper.pdf", { type: "application/pdf" }),
    new File(["notes"], "notes.txt"),
  ];
  await user.upload(screen.getByLabelText("Attach files"), files);
  upload.mockRejectedValueOnce(new Error("Upload failed"));
  await user.click(screen.getByRole("button", { name: /Save to inbox/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
  expect(onClose).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Save to inbox/ }));
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(capture.mock.calls[0]?.[0]).toMatchObject({ title: "paper.pdf" });
  expect(capture.mock.calls[0]?.[0].fileIds).toHaveLength(2);
});
test("pasted URLs become safe links without fetching the target", async () => {
  const { user } = await open();
  await user.keyboard("https://example.com/paper.pdf{Meta>}{Enter}{/Meta}");
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(capture.mock.calls[0]?.[0].links).toEqual([
    "https://example.com/paper.pdf",
  ]);
});
test("rejected scheduling keeps the capture and reuses its intent id", async () => {
  const { user, onClose } = await open();
  capture.mockRejectedValueOnce(new Error("That time is booked"));
  await user.keyboard("Read later{Enter}{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("booked");
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Save to inbox/ }));
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
  expect(capture.mock.calls[0]?.[0].id).toBe(capture.mock.calls[1]?.[0].id);
});
test("Tab navigates controls instead of changing duration, and focus returns to the launcher", async () => {
  const user = userEvent.setup();
  const launcher = document.createElement("button");
  launcher.textContent = "Launch";
  document.body.append(launcher);
  launcher.focus();
  const view = render(<QuickAdd onClose={() => undefined} />);
  await screen.findByRole("button", { name: /Physio exercises/ });
  await user.keyboard("Something{Enter}");
  await user.tab();
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  expect(screen.getByRole("spinbutton", { name: "Minutes" })).toHaveValue(15);
  view.unmount();
  expect(launcher).toHaveFocus();
  launcher.remove();
});
test("going back and changing text cannot save the previously selected subject", async () => {
  const { user } = await open();
  await user.keyboard("Original{Enter}");
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.clear(screen.getByRole("textbox", { name: "What to add" }));
  await user.keyboard("Replacement{Control>}{Enter}{/Control}");
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(capture.mock.calls[0]?.[0].title).toBe("Replacement");
});
test("closing preserves notes-only drafts and a selected activity's custom duration", async () => {
  const { user, onClose } = await open();
  await user.click(screen.getByRole("button", { name: "Add notes" }));
  await user.type(
    screen.getByLabelText("Notes (optional)"),
    "Notes without a title",
  );
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(vi.mocked(saveCaptureDraft).mock.lastCall?.[1]?.notes).toBe(
    "Notes without a title",
  );
  await user.click(screen.getByRole("button", { name: /Stretch 1/ }));
  const duration = screen.getByRole("spinbutton", { name: "Minutes" });
  await user.clear(duration);
  await user.type(duration, "37");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveCaptureDraft).mock.lastCall?.[1]?.subject).toMatchObject(
    { kind: "activity", id: "a1", minutes: 37 },
  );
});
test("a restored unconfirmed save retries its original appointment and activity", async () => {
  const startsAt = Math.ceil((Date.now() + 3600000) / 60000) * 60000;
  vi.mocked(readCaptureDraft).mockResolvedValue({
    id: crypto.randomUUID(),
    text: "",
    notes: "",
    files: [],
    subject: { kind: "activity", id: "a1", title: "Stretch", minutes: 37 },
    attempt: { startsAt, minutes: 37 },
  });
  const user = userEvent.setup();
  render(<QuickAdd onClose={() => undefined} />);
  await user.click(
    await screen.findByRole("button", { name: "Retry previous save" }),
  );
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(capture.mock.calls[0]?.[0]).toMatchObject({
    activityId: "a1",
    minutes: 37,
    startsAt,
  });
});
test("account change during a draft write cannot send capture contents to the new account", async () => {
  const { user, onClose } = await open();
  let resume: () => void = () => undefined;
  vi.mocked(saveCaptureDraft).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
  );
  await user.keyboard("Private reading{Control>}{Enter}{/Control}");
  await waitFor(() =>
    expect(screen.getByText("Saving… Keep this window open.")).toBeVisible(),
  );
  changeSession("different-account-session");
  resume();
  await screen.findByText("The session changed");
  expect(capture).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  changeSession(null);
});

test("repeated submit while in flight sends only one capture", async () => {
  const { user } = await open();
  let resolve: (value: { todoId: string; slotId: null }) => void = () =>
    undefined;
  capture.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await user.keyboard("Only once");
  const button = screen.getByRole("button", { name: /Save to inbox/ });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  resolve({ todoId: "one", slotId: null });
  await waitFor(() =>
    expect(screen.queryByText("Saving… Keep this window open.")).toBeNull(),
  );
});
