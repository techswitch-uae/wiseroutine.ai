import { describe, expect, it } from "vitest";
import config from "../content/release.json" with { type: "json" };
import { validateRelease } from "./release";

const download = {
  platform: "macOS (Apple silicon)",
  requirements: "Test fixture, not published availability",
  url: "https://downloads.wiseroutine.ai/test.dmg",
};

describe("public release claims", () => {
  it("offers real account signup independently of installer readiness", () => {
    expect(validateRelease(config).signupUrl).toBe(
      "https://app.wiseroutine.ai/signin",
    );
    expect(
      validateRelease({ ...config, status: "preview", downloads: [] })
        .signupUrl,
    ).toBe(config.signupUrl);
  });
  it.each([
    undefined,
    "http://app.wiseroutine.ai/signin",
    "https://app.wiseroutine.ai/",
    "https://app.wiseroutine.ai/signin?token=private",
    "https://user:secret@app.wiseroutine.ai/signin",
    "javascript:alert(1)",
    "#demo",
  ])("rejects an invalid signup destination: %s", (signupUrl) => {
    expect(() => validateRelease({ ...config, signupUrl })).toThrow();
  });
  it("validates the checked-in release before any build", () => {
    expect(() => validateRelease(config)).not.toThrow();
  });
  it("supports an explicitly validated live release", () => {
    expect(
      validateRelease({ ...config, status: "live", downloads: [download] })
        .downloads,
    ).toEqual([download]);
  });
  it.each([
    null,
    { status: "coming-soon", downloads: [] },
    { status: "preview", downloads: undefined },
    { status: "preview", downloads: [download] },
    { status: "live", downloads: [] },
    { status: "live", downloads: [{ ...download, requirements: "" }] },
    { status: "live", downloads: [{ ...download, platform: "" }] },
    { status: "live", downloads: [download, download] },
    ...[
      "http://downloads.wiseroutine.ai/app",
      "javascript:alert(1)",
      "/download",
      "https://secret:token@downloads.wiseroutine.ai/app",
      "https://localhost/app",
      "https://download.example/app",
    ].map((url) => ({ status: "live", downloads: [{ ...download, url }] })),
  ])("rejects unavailable, ambiguous or unsafe downloads: %j", (input) => {
    expect(() =>
      validateRelease(input === null ? null : { ...config, ...input }),
    ).toThrow();
  });
});
