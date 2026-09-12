import "../test-support/future-features";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { TodoDetails as Details } from "../lib/api";
import { TodoDetails } from "./todo-details";

const load = vi.fn<() => Promise<Details>>(),
  edit = vi.fn<() => Promise<void>>(),
  upload = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    todoDetails: () => load(),
    editTodo: (...args: unknown[]) => edit(...(args as [])),
    addTodoFile: () => upload(),
    setTodo: async () => undefined,
  },
}));
vi.mock("../lib/capture", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  refreshCaptured: vi.fn(),
}));
const todo = (): Details => ({
  id: "todo",
  title: "Original",
  notes: "Context",
  links: [],
  minutes: 20,
  needsFocus: false,
  createdAt: 0,
  status: "open",
  slotId: null,
  slot: null,
  files: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(todo());
  edit.mockResolvedValue();
  upload.mockRejectedValue(new Error("Offline"));
});
test("detail edits require explicit save/discard and cannot change under an in-flight save", async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  render(<TodoDetails id={todo().id} timeZone="UTC" onClose={close} />);
  await user.click(await screen.findByRole("button", { name: "Edit details" }));
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Revised");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText(/There are unsaved edits/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  let resolve: () => void = () => undefined;
  edit.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  load.mockResolvedValue({ ...todo(), title: "Revised" });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(title).toBeDisabled();
  expect(edit).toHaveBeenCalledWith(
    "todo",
    expect.objectContaining({ title: "Revised" }),
    expect.objectContaining({ generation: expect.any(Number) }),
  );
  resolve();
  await screen.findByRole("button", { name: "Edit details" });
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
test("an older detail refresh cannot hide a newly confirmed attachment", async () => {
  const user = userEvent.setup();
  render(
    <TodoDetails id={todo().id} timeZone="UTC" onClose={() => undefined} />,
  );
  await user.upload(
    await screen.findByLabelText("Add files"),
    new File(["PDF"], "first.pdf"),
  );
  await screen.findByText("Offline");
  let resolve: (value: Details) => void = () => undefined;
  load.mockImplementationOnce(
    () =>
      new Promise<Details>((r) => {
        resolve = r;
      }),
  );
  await user.click(
    screen.getByRole("button", {
      name: "Clear retry queue (keep saved files)",
    }),
  );
  upload.mockResolvedValue({ id: "file", name: "second.pdf", size: 3 });
  await user.upload(
    screen.getByLabelText("Add files"),
    new File(["PDF"], "second.pdf"),
  );
  await screen.findByText(/second.pdf ·/);
  // React's act returns a custom thenable, rather than a native Promise.
  await Promise.resolve(act(async () => resolve(todo())));
  expect(screen.getByText(/second.pdf ·/)).toBeVisible();
});

test("unconfirmed file uploads cannot silently disappear when finishing or closing a todo", async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  render(<TodoDetails id={todo().id} timeZone="UTC" onClose={close} />);
  await user.upload(
    await screen.findByLabelText("Add files"),
    new File(["PDF"], "paper.pdf"),
  );
  await screen.findByText("Offline");
  expect(screen.getByRole("button", { name: "Mark done" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(close).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", {
      name: "Clear retry queue (keep saved files)",
    }),
  );
  expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
});
