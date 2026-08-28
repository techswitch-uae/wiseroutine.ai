import { describe, expect, test } from "vitest";
import { checkForUpdate, type DownloadEvent, trackDownload } from "./updates";

const started = (contentLength?: number): DownloadEvent => ({
  event: "Started",
  data: contentLength === undefined ? {} : { contentLength },
});
const chunk = (chunkLength: number): DownloadEvent => ({
  event: "Progress",
  data: { chunkLength },
});
const finished: DownloadEvent = { event: "Finished" };

describe("trackDownload", () => {
  test("accumulates chunks against the advertised total", () => {
    const progress = trackDownload();
    progress(started(1000));
    expect(progress(chunk(250))).toBe(25);
    // The second chunk is 250 bytes, not 500 - the running total is kept here
    // because the events never carry one.
    expect(progress(chunk(250))).toBe(50);
    expect(progress(chunk(500))).toBe(100);
  });

  test("reports nothing when the server sent no length", () => {
    const progress = trackDownload();
    progress(started());
    expect(progress(chunk(4096))).toBeNull();
  });

  test("finishing is 100 even without a length", () => {
    const progress = trackDownload();
    progress(started());
    progress(chunk(4096));
    expect(progress(finished)).toBe(100);
  });

  test("cannot exceed 100 when the chunks overshoot", () => {
    const progress = trackDownload();
    progress(started(100));
    expect(progress(chunk(140))).toBe(100);
  });

  test("a second download starts from zero", () => {
    const progress = trackDownload();
    progress(started(100));
    progress(chunk(100));
    progress(started(200));
    expect(progress(chunk(50))).toBe(25);
  });
});

describe("checkForUpdate", () => {
  test("is a no-op outside Tauri, so the web build never calls the plugin", async () => {
    expect("__TAURI_INTERNALS__" in globalThis).toBe(false);
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
