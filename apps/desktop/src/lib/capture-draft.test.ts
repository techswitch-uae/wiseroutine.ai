import { afterEach, expect, test, vi } from "vitest";
import {
  isCaptureDraft,
  readCaptureDraft,
  saveCaptureDraft,
} from "./capture-draft";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const draft = () => ({
  id: crypto.randomUUID(),
  text: "Read this",
  notes: "",
  files: [{ id: crypto.randomUUID(), file: new File(["PDF"], "paper.pdf") }],
});
test("draft validation preserves File objects and rejects unreadable records instead of adopting them", () => {
  const d = draft();
  expect(isCaptureDraft(d)).toBe(true);
  expect(isCaptureDraft({ ...d, files: undefined })).toBe(false);
  expect(isCaptureDraft({ ...d, subject: { kind: "unknown" } })).toBe(false);
  expect(
    isCaptureDraft({
      ...d,
      files: [{ id: crypto.randomUUID(), file: { name: "paper.pdf" } }],
    }),
  ).toBe(false);
});
test("a stuck local database cannot indefinitely disable capture, and a late handle is closed", async () => {
  vi.useFakeTimers();
  const request = {} as IDBOpenDBRequest;
  const close = vi.fn();
  Object.defineProperty(request, "result", { value: { close } });
  vi.stubGlobal("indexedDB", { open: () => request });
  const pending = readCaptureDraft("account");
  const refused = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(2000);
  await refused;
  request.onsuccess?.call(request, new Event("success"));
  expect(close).toHaveBeenCalledOnce();
});
test("deletion waits for the previous write's commit and retains the captured account key", async () => {
  const requests: IDBOpenDBRequest[] = [];
  const transactions: IDBTransaction[] = [];
  const put = vi.fn(() => ({ result: "alice" }));
  const remove = vi.fn(() => ({ result: undefined }));
  const close = vi.fn();
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = {} as IDBOpenDBRequest;
      Object.defineProperty(request, "result", {
        value: {
          close,
          transaction: () => {
            const tx = {
              objectStore: () => ({ put, delete: remove }),
            } as unknown as IDBTransaction;
            transactions.push(tx);
            return tx;
          },
        },
      });
      requests.push(request);
      return request;
    },
  });
  const value = draft();
  const first = saveCaptureDraft("alice", value),
    second = saveCaptureDraft("bob", null);
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requests[0]?.onsuccess?.call(requests[0], new Event("success"));
  await vi.waitFor(() => expect(put).toHaveBeenCalledWith(value, "alice"));
  expect(remove).not.toHaveBeenCalled();
  transactions[0]?.oncomplete?.call(transactions[0], new Event("complete"));
  await first;
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  requests[1]?.onsuccess?.call(requests[1], new Event("success"));
  await vi.waitFor(() => expect(remove).toHaveBeenCalledWith("bob"));
  transactions[1]?.oncomplete?.call(transactions[1], new Event("complete"));
  await second;
  expect(close).toHaveBeenCalledTimes(2);
});
