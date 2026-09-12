// biome-ignore-all lint/style/noNonNullAssertion: Required synthetic fixtures and DOM nodes fail the test if absent.
import { mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  type ApprovalKeys,
  canonicalJSON,
  parseManifest,
} from "@wiseroutine/addons";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, type InstalledAddonRow } from "../lib/api";
import { changeSession, identifySession } from "../lib/session-lifecycle";
import { addonModules } from "./activity-type";
import { AddonFrame } from "./frame";
import { serve } from "./host";
import {
  boundedText,
  forgetAddon,
  frameUrlFor,
  type InstalledAddon,
  installedAddons,
  loadAddons,
  seedAddons,
} from "./installed";
import { addonStorageKey, writeAddonValue } from "./storage";

const testingKeys: ApprovalKeys = vi.hoisted(() => ({}));
vi.mock("../../../../addon-registry/trust.json", () => ({
  default: testingKeys,
}));
const manifest = (id = "review.alpha", version = "1.0.0") =>
  parseManifest({
    id,
    version,
    name: "Review",
    description: "Synthetic addon",
    capabilities: [],
  })!;
const addon = (id?: string, version?: string): InstalledAddon => ({
  manifest: manifest(id, version),
  granted: [],
  settings: {},
  bundle: `/* ${version ?? "1.0.0"} */`,
  author: "Review",
  bundled: true,
});
beforeEach(() => {
  localStorage.clear();
  seedAddons();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  seedAddons();
});
function bridge(a: InstalledAddon) {
  const channel = new MessageChannel();
  let id = 0;
  const stop = serve(channel.port1, a, () => ({ kind: "background" }));
  return {
    stop: () => {
      stop();
      channel.port2.close();
    },
    call: (method: string, params?: unknown) =>
      new Promise<{ result?: unknown; error?: unknown }>((resolve) => {
        const current = ++id;
        const receive = (event: MessageEvent) => {
          if (event.data?.id === current) {
            channel.port2.removeEventListener("message", receive);
            resolve(event.data);
          }
        };
        channel.port2.addEventListener("message", receive);
        channel.port2.start();
        channel.port2.postMessage({ id: current, method, params });
      }),
  };
}
test("real bridge storage and uninstall cannot collide across dotted IDs and keys", async () => {
  const outer = addon("review.alpha.beta"),
    inner = addon("review.alpha");
  seedAddons([outer, inner]);
  const a = bridge(outer),
    b = bridge(inner);
  try {
    await a.call("store.set", { key: "token", value: "synthetic-private" });
    expect(
      (await b.call("store.get", { key: "beta.token" })).result,
    ).toBeUndefined();
    await b.call("store.set", { key: "beta.token", value: "other" });
    expect((await a.call("store.get", { key: "token" })).result).toBe(
      "synthetic-private",
    );
    await forgetAddon("review.alpha");
    expect(installedAddons().has(inner.manifest.id)).toBe(false);
    seedAddons([outer, inner]);
    vi.stubGlobal("__TAURI_INTERNALS__", {
      invoke: vi.fn().mockRejectedValue(new Error("device cleanup failed")),
    });
    await expect(forgetAddon(inner.manifest.id)).rejects.toThrow(
      "device cleanup failed",
    );
    expect(installedAddons().has(inner.manifest.id)).toBe(false);
    expect(installedAddons().get(outer.manifest.id)).toBe(outer);
    expect((await a.call("store.get", { key: "token" })).result).toBe(
      "synthetic-private",
    );
  } finally {
    a.stop();
    b.stop();
  }
});
test("per-addon key, byte and value quotas preserve unrelated application storage", () => {
  localStorage.setItem("important-app-state", "keep");
  for (let i = 0; i < 64; i++)
    writeAddonValue(localStorage, "review.alpha", `key${i}`, "x");
  expect(() =>
    writeAddonValue(localStorage, "review.alpha", "overflow", "x"),
  ).toThrow("quota");
  writeAddonValue(localStorage, "review.alpha", "key0", undefined);
  writeAddonValue(localStorage, "review.alpha", "replacement", "okay");
  expect(() =>
    writeAddonValue(localStorage, "review.beta", "big", "é".repeat(9000)),
  ).toThrow("16 KiB");
  expect(localStorage.getItem("important-app-state")).toBe("keep");
  expect(addonStorageKey("review.alpha.beta", "x")).not.toBe(
    addonStorageKey("review.alpha", "beta.x"),
  );
});
test("prototype methods and oversized wire parameters are refused", async () => {
  const a = bridge(addon());
  try {
    expect((await a.call("toString")).error).toBeDefined();
    expect((await a.call("constructor")).error).toBeDefined();
    expect(
      (await a.call("settings", { value: "x".repeat(65537) })).error,
    ).toBeDefined();
  } finally {
    a.stop();
  }
});
test("ordinary object refresh keeps a connection; a changed release replaces document and handshakes", () => {
  const first = addon();
  const context = { kind: "background" as const };
  const view = render(
    <AddonFrame title="Review" addon={first} context={context} />,
  );
  const frame = view.container.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.load(frame);
  expect(post).toHaveBeenCalledOnce();
  view.rerender(
    <AddonFrame title="Review" addon={{ ...first }} context={context} />,
  );
  expect(view.container.querySelector("iframe")).toBe(frame);
  expect(post).toHaveBeenCalledOnce();
  view.rerender(
    <AddonFrame
      title="Review"
      addon={addon("review.alpha", "2.0.0")}
      context={context}
    />,
  );
  const second = view.container.querySelector("iframe")!;
  expect(second).not.toBe(frame);
  expect(second.srcdoc).toContain("2.0.0");
  const nextPost = vi.spyOn(second.contentWindow!, "postMessage");
  fireEvent.load(second);
  expect(nextPost).toHaveBeenCalledOnce();
});
test.each(["macos", "windows"] as const)(
  "native frame URLs preserve path separators with Tauri's actual %s encoder",
  (platform) => {
    changeSession("synthetic-frame-test");
    identifySession("user/with%value");
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    mockConvertFileSrc(platform);
    const revision = "a".repeat(64);
    const prefix =
      platform === "windows" ? "http://addon.localhost/" : "addon://localhost/";
    expect(frameUrlFor("example.test", revision)).toBe(
      `${prefix}user%2Fwith%25value/example.test/${revision}`,
    );
  },
);

test("bundle downloads fail closed on size and invalid UTF-8", async () => {
  await expect(boundedText(new Response("too large"), 3)).rejects.toThrow(
    "size limit",
  );
  await expect(
    boundedText(new Response(new Uint8Array([255]))),
  ).rejects.toThrow();
});
test("installed v1 never receives catalog v2 bytes, including locally bundled releases", async () => {
  const row: InstalledAddonRow = {
    id: "wiseroutine.test",
    version: "1.0.0",
    manifest: manifest("wiseroutine.test"),
    granted: [],
    settings: {},
    isEnabled: true,
    installedAt: 1,
    bundled: true,
    revoked: false,
  };
  vi.spyOn(api, "installedAddons").mockResolvedValue({ addons: [row] });
  const catalog = vi.spyOn(api, "availableAddons").mockResolvedValue({
    addons: [
      {
        id: row.id,
        version: "2.0.0",
        manifest: manifest(row.id, "2.0.0"),
        bundleUrl: "/v2.js",
        bundleHash: "a".repeat(64),
        author: "Test",
      },
    ],
  });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(manifest(row.id, "2.0.0"))));
  vi.stubGlobal("fetch", fetcher);
  await loadAddons();
  expect(installedAddons().size).toBe(0);
  expect(catalog).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("a withdrawal tears down cached addons without requesting another bundle", async () => {
  const loaded = addon("wiseroutine.test");
  seedAddons([loaded]);
  vi.spyOn(api, "installedAddons").mockResolvedValue({
    addons: [
      {
        id: loaded.manifest.id,
        version: "1.0.0",
        manifest: loaded.manifest,
        granted: [],
        settings: {},
        isEnabled: true,
        installedAt: 1,
        bundled: true,
        revoked: true,
      },
    ],
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await loadAddons();
  expect(installedAddons().size).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});
test("community releases are pinned by signed manifest/version/digest and expire offline", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  testingKeys.test = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const { sha256Hex } = await import("./installed");
  const bundle = "/* approved-v1 */";
  const payload = {
    format: 1 as const,
    id: "review.alpha",
    version: "1.0.0",
    manifest: manifest(),
    bundleHash: await sha256Hex(bundle),
    author: "Review",
    license: "MIT" as const,
    source: {
      repository: "https://github.com/example/review",
      commit: "a".repeat(40),
    },
  };
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(canonicalJSON(payload)),
    ),
  );
  const approval = {
    payload,
    keyId: "test",
    signature: btoa(String.fromCharCode(...signed)),
  };
  const row: InstalledAddonRow = {
    id: payload.id,
    version: payload.version,
    manifest: payload.manifest,
    approval,
    bundleHash: payload.bundleHash,
    granted: [],
    settings: {},
    isEnabled: true,
    installedAt: 1,
    bundled: false,
    revoked: false,
  };
  const listing = vi
    .spyOn(api, "installedAddons")
    .mockResolvedValue({ addons: [row] });
  const download = vi
    .spyOn(api, "addonBundle")
    .mockResolvedValue(new Response(bundle));
  const latest = vi.spyOn(api, "availableAddons");
  await loadAddons();
  expect(installedAddons().get(row.id)?.bundle).toBe(bundle);
  expect(download).toHaveBeenCalledWith(payload.bundleHash);
  expect(latest).not.toHaveBeenCalled();
  listing.mockResolvedValue({
    addons: [{ ...row, bundleHash: "b".repeat(64) }],
  });
  await loadAddons();
  expect(installedAddons().size).toBe(0);
  expect(download).toHaveBeenCalledTimes(1);
  download.mockResolvedValue(new Response(bundle));
  listing.mockResolvedValue({ addons: [row] });
  await loadAddons();
  listing.mockRejectedValue(new Error("offline"));
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 300001);
  await loadAddons();
  expect(installedAddons().size).toBe(0);
});

test("module components remain stable across shell renders", () => {
  const a = addon();
  a.manifest.activityTypes = [
    {
      key: "pause",
      name: "Pause",
      blurb: "Pause",
      defaults: { sessionMinutes: 2, startPolicy: "manual" },
      settings: [],
    },
  ];
  seedAddons([a]);
  expect(addonModules()["review.alpha/pause"]?.Session).toBe(
    addonModules()["review.alpha/pause"]?.Session,
  );
});
