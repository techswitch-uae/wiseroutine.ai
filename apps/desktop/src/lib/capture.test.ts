import { expect, test, vi } from "vitest";
import { ApiError, api } from "./api";
import {
  addLocalDays,
  captureError,
  dateIn,
  linksIn,
  pickedTime,
  wallTimes,
} from "./capture";
import { captureSessionScope, onServerInvalidated } from "./session-lifecycle";

test("a scoped capture refuses a replaced token even without a local generation event", async () => {
  const scope = captureSessionScope(),
    old = localStorage.getItem("wiseroutine.session"),
    send = vi.fn();
  vi.stubGlobal("fetch", send);
  localStorage.setItem("wiseroutine.session", "other-session");
  try {
    await expect(
      api.capture(
        {
          id: crypto.randomUUID(),
          title: "Private",
          notes: "",
          links: [],
          minutes: 15,
          fileIds: [],
        },
        scope,
      ),
    ).rejects.toThrow("session changed");
    expect(send).not.toHaveBeenCalled();
  } finally {
    if (old === null) localStorage.removeItem("wiseroutine.session");
    else localStorage.setItem("wiseroutine.session", old);
    vi.unstubAllGlobals();
  }
});
test("capture errors show the server's actionable refusal", () => {
  expect(
    captureError(
      new ApiError(409, { message: "That time overlaps a meeting." }),
    ),
  ).toBe("That time overlaps a meeting.");
});

test("file staging does not reload the calendar for every upload, but capture does", async () => {
  const changed = vi.fn(),
    stop = onServerInvalidated(changed);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
  );
  try {
    const id = crypto.randomUUID(),
      file = new File(["PDF"], "paper.pdf");
    await api.discardCaptureFiles(id);
    await api.uploadCaptureFile(id, crypto.randomUUID(), file);
    await api.addTodoFile(id, crypto.randomUUID(), file);
    expect(changed).not.toHaveBeenCalled();
    await api.capture({
      id,
      title: "Reading",
      notes: "",
      links: [],
      minutes: 15,
      fileIds: [],
    });
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    stop();
    vi.unstubAllGlobals();
  }
});

test("wall-time selection rejects skipped DST hours and invalid calendar dates", () => {
  expect(wallTimes("2026-03-29", "02:30", "Europe/Rome")).toEqual([]);
  expect(wallTimes("2026-02-30", "09:00", "UTC")).toEqual([]);
  expect(wallTimes("2026-10-01", "25:00", "UTC")).toEqual([]);
  expect(() => pickedTime("2026-03-29", "02:30", "Europe/Rome", 0)).toThrow(
    "does not exist",
  );
});
test("fall-back offers both occurrences instead of silently guessing", () => {
  const times = wallTimes("2026-10-25", "02:30", "Europe/Rome");
  expect(times).toHaveLength(2);
  expect((times[1] ?? 0) - (times[0] ?? 0)).toBe(3600000);
});
test("changing from a repeated time to an ordinary date discards the obsolete occurrence", () => {
  expect(
    pickedTime(
      "2026-10-26",
      "02:30",
      "Europe/Rome",
      Date.parse("2026-10-01"),
      1,
    ),
  ).toBe(wallTimes("2026-10-26", "02:30", "Europe/Rome")[0]);
});
test("dates follow the account zone, and tomorrow preserves the local date over DST", () => {
  expect(dateIn(Date.parse("2026-09-10T02:00:00Z"), "America/New_York")).toBe(
    "2026-09-09",
  );
  expect(addLocalDays("2026-03-28", 1)).toBe("2026-03-29");
  expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
});
test("links are extracted without unsafe protocols or embedded credentials", () => {
  expect(
    linksIn("Read https://example.com/a and https://example.com/a"),
  ).toEqual(["https://example.com/a"]);
  expect(
    linksIn(
      'Read (https://example.com/a_(b)). and "https://example.com/other"',
    ),
  ).toEqual(["https://example.com/a_(b)", "https://example.com/other"]);
  expect(
    linksIn("javascript:alert(1) https://user:secret@example.com/"),
  ).toEqual([]);
});
