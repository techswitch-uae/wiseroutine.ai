import { render } from "@testing-library/react";
import type { AddonManifest } from "@wiseroutine/addons";
import { parseManifest } from "@wiseroutine/addons";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { publishPlan, resetPlans } from "../lib/plan-store";
import { AddonFrame } from "./frame";
import { type AddonContext, dispatchQuickAdd, serve } from "./host";
import type { InstalledAddon } from "./installed";

/**
 * The boundary, tested adversarially.
 *
 * These are the tests that matter most in this directory, and they are written
 * from the attacker's side on purpose: not "does a well-behaved addon work",
 * which the app proves every time a breathing session opens, but "what happens
 * when one does not behave". An addon is code somebody else wrote, shipped to
 * a machine holding a calendar and a thirty-day bearer token, and the only
 * useful question about a sandbox is what it refuses.
 *
 * Written before the registry exists, deliberately. It is much cheaper to fix
 * a boundary before anyone is invited through it.
 */

/**
 * Where a link would go.
 *
 * Mocked rather than exercised: the real one hands the URL to the operating
 * system, and a test suite that opens a browser is a test suite nobody runs
 * twice. What is under test is everything *before* that call - which is where
 * the whole of this capability lives.
 */
const opened: string[] = [];
vi.mock("../lib/open-external", () => ({
  openExternal: async (url: string) => {
    opened.push(url);
    return true;
  },
}));

const manifest = (over: Partial<AddonManifest> = {}): AddonManifest => {
  const base = parseManifest({
    id: "acme.fitness",
    name: "Acme Fitness",
    version: "1.0.0",
    description: "x",
    capabilities: [{ kind: "ui:session" }],
  });
  if (!base) throw new Error("fixture manifest is not valid");
  return { ...base, ...over };
};

/** The manifest, installed. Granted everything it asks for unless said. */
const installed = (
  addon: AddonManifest,
  over: Partial<InstalledAddon> = {},
): InstalledAddon => ({
  manifest: addon,
  granted: addon.capabilities,
  settings: {},
  author: "Acme",
  bundled: false,
  bundle: "/* addon */",
  ...over,
});

const SLOT = { id: "s1", title: "Breathing", startsAt: 0, endsAt: 60_000 };
const CONFIG = { pattern: "4-7-8" };
const SESSION: AddonContext = {
  kind: "session",
  slot: SLOT,
  config: CONFIG,
  finish: () => undefined,
};

/**
 * Talk to the host the way an addon does, and get the raw reply.
 *
 * Deliberately not the SDK client: the SDK is what a *co-operating* addon
 * uses, and a test of the boundary must be able to send things the SDK would
 * never send.
 */
function connectTo(
  addon: AddonManifest | InstalledAddon,
  context: AddonContext = SESSION,
): {
  call: (method: string, params?: unknown) => Promise<unknown>;
  stop: () => void;
} {
  const channel = new MessageChannel();
  const served = "manifest" in addon ? addon : installed(addon);
  const stop = serve(channel.port1, served, () => context);
  channel.port2.start();

  let nextId = 1;
  const call = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve) => {
      const id = nextId++;
      const onMessage = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        channel.port2.removeEventListener("message", onMessage);
        resolve(event.data);
      };
      channel.port2.addEventListener("message", onMessage);
      channel.port2.postMessage({ id, method, params });
    });

  return {
    call,
    stop: () => {
      stop();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

const denied = (reply: unknown): boolean =>
  (reply as { error?: { kind?: string } })?.error?.kind === "denied";

describe("the frame an addon runs in", () => {
  const frameOf = (addon: AddonManifest) => {
    const { container } = render(
      <AddonFrame title="Session" addon={installed(addon)} context={SESSION} />,
    );
    const frame = container.querySelector("iframe");
    if (!frame) throw new Error("no frame rendered");
    return frame;
  };

  /**
   * The single most important assertion in this repository.
   *
   * `allow-same-origin` turns the sandbox off. With it the frame is the app's
   * origin: it can read `localStorage["wiseroutine.session"]` - a thirty-day
   * bearer token for the whole API - reach the app's DOM, and be granted
   * Tauri's IPC. Every other protection here assumes this attribute is absent.
   */
  test("never grants the addon the app's origin", () => {
    const sandbox = frameOf(manifest()).getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  // Each of these is a way to reach past the frame at the user: a popup or a
  // modal draws outside it, top-navigation replaces the app, and a form posts
  // somewhere connect-src never sees.
  test.each([
    "allow-popups",
    "allow-modals",
    "allow-top-navigation",
    "allow-forms",
    "allow-pointer-lock",
  ])("does not grant %s", (permission) => {
    expect(frameOf(manifest()).getAttribute("sandbox")).not.toContain(
      permission,
    );
  });

  test("an addon that asked for no network may reach nothing", () => {
    const html = frameOf(manifest()).getAttribute("srcdoc") ?? "";
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
  });

  test("an addon may reach exactly the origins it was granted", () => {
    const withNet = manifest({
      capabilities: [
        { kind: "ui:session" },
        { kind: "net:fetch", origins: ["https://api.acme.example"] },
      ],
    });
    const html = frameOf(withNet).getAttribute("srcdoc") ?? "";
    expect(html).toContain("connect-src https://api.acme.example");
    expect(html).not.toContain("connect-src *");
  });

  /** The policy comes from the grant, not the manifest. */
  test("an origin the manifest asks for but the user refused is not reachable", () => {
    const withNet = manifest({
      capabilities: [
        { kind: "ui:session" },
        { kind: "net:fetch", origins: ["https://api.acme.example"] },
      ],
    });
    const { container } = render(
      <AddonFrame
        title="Session"
        addon={installed(withNet, { granted: [{ kind: "ui:session" }] })}
        context={SESSION}
      />,
    );
    const html =
      container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
    expect(html).toContain("connect-src 'none'");
  });

  test("denies device features outright", () => {
    const frame = frameOf(manifest());
    expect(frame.getAttribute("allow")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  /**
   * A bundle is text the host puts inside a `<script>` element. A bundle
   * containing `</script>` would close it early and the rest would be parsed
   * as markup - which is how an addon would escape its own script element and
   * write arbitrary HTML into the document that constrains it.
   */
  test("a bundle cannot close its own script element", () => {
    const { container } = render(
      <AddonFrame
        title="Session"
        addon={installed(manifest(), {
          bundle:
            '</script><meta http-equiv="Content-Security-Policy" content="">',
        })}
        context={SESSION}
      />,
    );
    const html =
      container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
    expect(html).not.toContain("</script><meta");
    expect(html).toContain("<\\/script>");
  });
});

/**
 * The packaged app serves the frame instead of writing it inline.
 *
 * A `srcdoc` document inherits its parent's Content-Security-Policy, so in a
 * release build - where the app ships `default-src 'self'` - the addon's own
 * script is refused and the session opens empty. A fetched document does not
 * inherit; it carries the policy `src-tauri/src/addons.rs` builds for it.
 *
 * This is the test that notices if the served path is ever quietly dropped.
 * It cannot be caught by running the app in development: there, Vite serves
 * the page and Tauri attaches no policy at all, so both routes work.
 */
describe("where the frame comes from", () => {
  const withTauri = (fn: () => void) => {
    const host = globalThis as unknown as { __TAURI_INTERNALS__?: unknown };
    host.__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, protocol: string) =>
        `${protocol}://localhost/${path}`,
    };
    try {
      fn();
    } finally {
      delete host.__TAURI_INTERNALS__;
    }
  };

  const frameOf = (addon: AddonManifest) => {
    const { container } = render(
      <AddonFrame title="Session" addon={installed(addon)} context={SESSION} />,
    );
    const frame = container.querySelector("iframe");
    if (!frame) throw new Error("no frame rendered");
    return frame;
  };

  test("is served over its own scheme when there is a host to serve it", () => {
    withTauri(() => {
      const frame = frameOf(manifest());
      expect(frame.getAttribute("src")).toBe("addon://localhost/acme.fitness");
      // Both would be a document that still inherits.
      expect(frame.getAttribute("srcdoc")).toBeNull();
      // The origin is opaque either way: the scheme buys the policy, the
      // sandbox buys the isolation, and neither replaces the other.
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    });
  });

  test("falls back to srcdoc in the web build, which has no host", () => {
    const frame = frameOf(manifest());
    expect(frame.getAttribute("src")).toBeNull();
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  });
});

describe("what the host refuses", () => {
  test("a method that does not exist is refused, not ignored", async () => {
    const { call, stop } = connectTo(manifest());
    expect(denied(await call("deleteEverything"))).toBe(true);
    stop();
  });

  /**
   * The capability the addon holds is the one in its manifest, and the host
   * names the capability each handler needs. An addon cannot assert its way
   * into one by phrasing the request differently.
   */
  test("reading the day needs read:schedule, which ui:session is not", async () => {
    const { call, stop } = connectTo(manifest());
    expect(denied(await call("day"))).toBe(true);
    stop();
  });

  test("writing needs write:own", async () => {
    const { call, stop } = connectTo(manifest());
    const reply = await call("setSlotStatus", {
      slotId: "someone-elses",
      status: "completed",
    });
    expect(denied(reply)).toBe(true);
    stop();
  });

  /** The grant is what the user approved. The manifest is what was asked. */
  test("checks the grant, not the manifest", async () => {
    const asks = manifest({
      capabilities: [
        { kind: "ui:session" },
        { kind: "read:schedule", scope: "today" },
      ],
    });
    const { call, stop } = connectTo(
      installed(asks, { granted: [{ kind: "ui:session" }] }),
    );
    expect(denied(await call("day"))).toBe(true);
    stop();
  });

  test("a notification needs notify", async () => {
    const { call, stop } = connectTo(manifest());
    expect(denied(await call("notify", { title: "Hi" }))).toBe(true);
    stop();
  });

  test("host fetch is refused for an origin outside the grant", async () => {
    const withNet = manifest({
      capabilities: [
        { kind: "ui:session" },
        { kind: "net:fetch", origins: ["https://api.acme.example"] },
      ],
    });
    const { call, stop } = connectTo(withNet);
    expect(
      denied(await call("fetch", { input: "https://evil.example/x" })),
    ).toBe(true);
    // Inside the grant, but this is the web build: no Rust to fetch through.
    const reply = (await call("fetch", {
      input: "https://api.acme.example/x",
    })) as { error?: { message: string } };
    expect(reply.error?.message).toContain("desktop app");
    stop();
  });

  // Cancelled, missed and planned are the app's to set. An addon may say a
  // thing it owns is finished or was skipped, and nothing else.
  test("a status outside completed and skipped is refused", async () => {
    const writer = manifest({
      capabilities: [{ kind: "ui:session" }, { kind: "write:own" }],
    });
    const { call, stop } = connectTo(writer);
    expect(
      denied(
        await call("setSlotStatus", { slotId: "s1", status: "cancelled" }),
      ),
    ).toBe(true);
    stop();
  });

  /**
   * A port that keeps answering after its frame is gone is an addon that can
   * still act after the user closed it.
   */
  test("a stopped port answers nothing", async () => {
    const { call, stop } = connectTo(manifest());
    stop();
    const settled = await Promise.race([
      call("session"),
      new Promise((resolve) => setTimeout(() => resolve("no answer"), 50)),
    ]);
    expect(settled).toBe("no answer");
  });
});

describe("what the host allows", () => {
  test("an addon is given the session it was loaded for", async () => {
    const { call, stop } = connectTo(manifest());
    const reply = (await call("session")) as { result?: unknown };
    // The theme is not here: it travels with the port, in the handshake, so
    // that a widget - which never calls `session` - has it too, and so that
    // neither pays a round trip for a value that cannot change.
    expect(reply.result).toMatchObject({ slot: SLOT, config: CONFIG });
    stop();
  });

  test("an addon may end its own session early", async () => {
    let finished = 0;
    const { call, stop } = connectTo(manifest(), {
      ...SESSION,
      finish: () => {
        finished += 1;
      },
    } as AddonContext);
    await call("finishSession");
    expect(finished).toBe(1);
    stop();
  });

  test("the store keeps a JSON value per key, on this device", async () => {
    const { call, stop } = connectTo(manifest());
    await call("store.set", { key: "seen", value: { at: 5 } });
    const reply = (await call("store.get", { key: "seen" })) as {
      result?: unknown;
    };
    expect(reply.result).toEqual({ at: 5 });
    expect(denied(await call("store.set", { key: "../x", value: 1 }))).toBe(
      true,
    );
    stop();
  });

  test("addon settings are handed over without secrets", async () => {
    const { call, stop } = connectTo(
      installed(manifest(), { settings: { region: "eu" } }),
    );
    const reply = (await call("settings")) as { result?: unknown };
    expect(reply.result).toEqual({ region: "eu" });
    stop();
  });

  /**
   * The addon does not name a slot, so it cannot name a different one. There
   * is no parameter to tamper with - which is a better protection than
   * validating one.
   */
  test("the session is given, not asked for", async () => {
    const { call, stop } = connectTo(manifest());
    const reply = (await call("session", { slotId: "someone-elses" })) as {
      result?: { slot?: { id?: string } };
    };
    expect(reply.result?.slot?.id).toBe("s1");
    stop();
  });
});

/**
 * Opening a link leaves the sandbox entirely.
 *
 * Whatever is on the other side runs in the user's own browser, as the user,
 * with their cookies and their sessions, and nothing in this app is between
 * them any more. So it is the narrowest capability here: granted per origin,
 * https only, and re-checked against the URL actually being opened rather than
 * against the grant alone - because an addon computes the URL it opens, and
 * what was approved is not necessarily what arrives.
 */
describe("opening a link outside the app", () => {
  const SPOTIFY = "https://open.spotify.com";

  const withOpener = (origins: string[]) =>
    manifest({
      capabilities: [
        { kind: "ui:session" },
        { kind: "open:external", origins },
      ],
    });

  beforeEach(() => {
    opened.length = 0;
  });

  test("opens a link on an origin the manifest declared", async () => {
    const { call, stop } = connectTo(withOpener([SPOTIFY]));
    const reply = (await call("openExternal", {
      url: `${SPOTIFY}/playlist/abc`,
    })) as { result?: unknown };

    expect(reply.result).toBe(true);
    expect(opened).toEqual([`${SPOTIFY}/playlist/abc`]);
    stop();
  });

  test("refuses an addon that was not granted it at all", async () => {
    const { call, stop } = connectTo(manifest());
    expect(denied(await call("openExternal", { url: `${SPOTIFY}/x` }))).toBe(
      true,
    );
    expect(opened).toEqual([]);
    stop();
  });

  /**
   * The check that makes the grant mean anything.
   *
   * An addon builds the URL it opens, so a grant checked only at install would
   * let one approved for a player open a phishing page. The origin of the URL
   * in hand is compared to the list, every call.
   */
  test("refuses an origin it was not granted, however plausible", async () => {
    const { call, stop } = connectTo(withOpener([SPOTIFY]));

    for (const url of [
      "https://evil.example/",
      // The declared origin as a path, a subdomain and a prefix. All three are
      // different origins, and all three are the shapes a fake link takes.
      "https://evil.example/https://open.spotify.com/x",
      "https://open.spotify.com.evil.example/x",
      "https://openspotify.com/x",
    ]) {
      expect(denied(await call("openExternal", { url }))).toBe(true);
    }

    expect(opened).toEqual([]);
    stop();
  });

  /**
   * A scheme is not a host, and some of them are instructions to the machine.
   *
   * The app itself opens `x-apple.systempreferences:` URLs and is entitled to.
   * An addon is not, and refusing by scheme rather than by allowlist means a
   * scheme nobody has thought of yet is refused too.
   */
  test("refuses anything that is not plain https", async () => {
    const { call, stop } = connectTo(
      // Granted the widest thing that can be granted, so what refuses these is
      // the scheme check and not a missing origin.
      withOpener([SPOTIFY]),
    );

    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
      "http://open.spotify.com/x",
      "not a url at all",
      "",
    ]) {
      expect(denied(await call("openExternal", { url }))).toBe(true);
    }

    expect(opened).toEqual([]);
    stop();
  });

  test("refuses a call with no link in it", async () => {
    const { call, stop } = connectTo(withOpener([SPOTIFY]));
    expect(denied(await call("openExternal", {}))).toBe(true);
    expect(denied(await call("openExternal", { url: 42 }))).toBe(true);
    expect(opened).toEqual([]);
    stop();
  });
});

/**
 * A card in the rail, which is the other thing an addon may be.
 *
 * The surface is one method, and that is the design rather than an accident.
 * An addon draws the inside of its own frame and says three things about the
 * outside: the eyebrow, the height, and whether the card is there at all.
 * Everything else about the card - its ground, its radius, where it sits in
 * the rail - belongs to the host, and there is no way to ask about any of it.
 *
 * So these tests are mostly about what the one method cannot be made to do.
 */
describe("a widget's card", () => {
  /** What the host would draw, captured instead of drawn. */
  const widget = (
    capabilities: AddonManifest["capabilities"] = [
      { kind: "ui:widget" },
      { kind: "read:schedule", scope: "today" },
    ],
  ) => {
    const shown: (unknown | null)[] = [];
    const { call, stop } = connectTo(manifest({ capabilities }), {
      kind: "widget",
      widgetKey: "progress",
      present: (card) => shown.push(card),
    });
    return { call, stop, shown };
  };

  test("appears when the addon asks, with what it asked for", async () => {
    const { call, stop, shown } = widget();
    await call("card", { card: { eyebrow: "Day so far", height: 150 } });
    expect(shown).toEqual([{ eyebrow: "Day so far", height: 150 }]);
    stop();
  });

  /**
   * The card an addon can take away is its own, and that is the whole reach of
   * it: there is no parameter naming which card, so there is nothing to point
   * at somebody else's.
   */
  test("can take itself off the rail", async () => {
    const { call, stop, shown } = widget();
    await call("card", { card: null });
    await call("card", {});
    expect(shown).toEqual([null, null]);
    stop();
  });

  /**
   * The rail is shared. An addon that could name its own height could push
   * every other card off the screen by asking for four thousand pixels, and
   * one that asked for zero would be a labelled card that appears to have
   * failed to load.
   */
  test("cannot grow beyond what the rail will give it", async () => {
    const { call, stop, shown } = widget();
    for (const height of [4000, -20, 0, Number.NaN, "tall", undefined]) {
      await call("card", { card: { height } });
    }
    for (const card of shown) {
      const { height } = card as { height: number };
      expect(height).toBeGreaterThanOrEqual(40);
      expect(height).toBeLessThanOrEqual(320);
    }
    stop();
  });

  /** The eyebrow is the only text the host draws on an addon's behalf, so it
   *  is bounded: a label is a label, not a paragraph in a label's clothes. */
  test("cannot write an essay in the eyebrow", async () => {
    const { call, stop, shown } = widget();
    await call("card", { card: { eyebrow: "x".repeat(500) } });
    const { eyebrow } = shown[0] as { eyebrow: string };
    expect(eyebrow.length).toBeLessThanOrEqual(40);
    stop();
  });

  test("refuses an addon that was not granted ui:widget", async () => {
    const { call, stop, shown } = widget([
      { kind: "read:schedule", scope: "today" },
    ]);
    expect(denied(await call("card", { card: { height: 100 } }))).toBe(true);
    expect(shown).toEqual([]);
    stop();
  });

  /**
   * The two contexts refuse each other's questions, and not because a
   * capability is missing - because the question is meaningless. A card has no
   * slot, and a session has no eyebrow to set.
   */
  test("a widget cannot ask for a session", async () => {
    const { call, stop } = widget([
      { kind: "ui:widget" },
      { kind: "ui:session" },
    ]);
    expect(denied(await call("session"))).toBe(true);
    stop();
  });

  test("a session cannot draw a card", async () => {
    const { call, stop } = connectTo(
      manifest({
        capabilities: [{ kind: "ui:session" }, { kind: "ui:widget" }],
      }),
      SESSION,
    );
    expect(denied(await call("card", { card: { height: 100 } }))).toBe(true);
    stop();
  });

  /**
   * A widget-only addon is not a second kind of addon.
   *
   * It declares no activity types, asks for `ui:widget` rather than
   * `ui:session`, and travels the same manifest parser, the same capability
   * check and the same sandbox as every other. This asserts the first half:
   * the parser accepts a manifest with widgets and nothing else.
   */
  test("a manifest with a widget and no session is a valid addon", () => {
    const parsed = parseManifest({
      id: "acme.day",
      name: "Acme Day",
      version: "1.0.0",
      description: "A card and nothing else.",
      capabilities: [
        { kind: "ui:widget" },
        { kind: "read:schedule", scope: "today" },
      ],
      widgets: [{ key: "progress", name: "Day so far" }],
    });
    expect(parsed?.widgets).toEqual([{ key: "progress", name: "Day so far" }]);
    expect(parsed?.activityTypes).toEqual([]);
  });
});

/**
 * The host speaking first.
 *
 * The one message that is not an answer, and the reason a rail card does not
 * need a timer. Without it every widget wanting to stay current would poll -
 * a wakeup the machine pays for whether or not anything happened, and a card
 * that goes on saying "3 of 7 done" for the rest of its interval after the
 * user pressed Done.
 */
describe("being told the day changed", () => {
  beforeEach(() => resetPlans());

  /** On the port, so it reaches this addon and no other. The rest of the page
   *  has no way to hear it and no way to send it. */
  const listen = (port: MessagePort): unknown[] => {
    const heard: unknown[] = [];
    port.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.event) heard.push(event.data);
    });
    port.start();
    return heard;
  };

  test("tells the addon, without telling it what changed", async () => {
    const channel = new MessageChannel();
    const heard = listen(channel.port2);
    const stop = serve(channel.port1, installed(manifest()), () => SESSION);

    publishPlan(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No payload. One would be a second copy of the narrowing in `day` - the
    // same fields, filtered the same way, in a second place to get wrong.
    expect(heard).toEqual([{ event: "day" }]);
    stop();
  });

  /**
   * A subscription that outlived its frame would be a torn-down addon still
   * being woken for the rest of the session, and a `postMessage` into a closed
   * port every time the day moved.
   */
  test("stops when the frame does", async () => {
    const channel = new MessageChannel();
    const heard = listen(channel.port2);
    const stop = serve(channel.port1, installed(manifest()), () => SESSION);
    stop();

    publishPlan(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual([]);
  });
});

describe("todos and quick add", () => {
  test("the list is a grant of its own, refused to an addon without it", async () => {
    const { call, stop } = connectTo(manifest());
    expect(denied(await call("todos.list"))).toBe(true);
    expect(denied(await call("todos.add", { title: "x" }))).toBe(true);
    stop();
  });

  /** Play an addon frame: answer a quick add request the way the SDK does. */
  const frame = (
    id: string,
    kind: AddonContext["kind"],
    answer: (request: unknown) => { message?: string; error?: string },
  ) => {
    const channel = new MessageChannel();
    const heard: unknown[] = [];
    channel.port2.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.event !== "quickAdd") return;
      heard.push(event.data.request);
      channel.port2.postMessage({
        event: "quickAdd:done",
        requestId: event.data.requestId,
        ...answer(event.data.request),
      });
    });
    channel.port2.start();
    const context: AddonContext =
      kind === "background"
        ? { kind: "background" }
        : kind === "widget"
          ? { kind: "widget", widgetKey: "w", present: () => undefined }
          : SESSION;
    const stop = serve(
      channel.port1,
      installed(manifest({ id })),
      () => context,
    );
    return { heard, stop };
  };

  test("what Quick add typed reaches the addon, and the answer comes back", async () => {
    const todos = frame("acme.todos", "widget", () => ({ message: "Kept" }));
    const request = { key: "todo", title: "Reply to Anders", minutes: 15 };

    await expect(dispatchQuickAdd("acme.todos", request)).resolves.toEqual({
      ok: true,
      message: "Kept",
    });
    expect(todos.heard).toEqual([request]);
    await expect(dispatchQuickAdd("acme.other", request)).resolves.toEqual({
      ok: false,
      message: "That addon isn't running.",
    });

    // Torn down, so nothing is listening.
    todos.stop();
    await expect(dispatchQuickAdd("acme.todos", request)).resolves.toEqual({
      ok: false,
      message: "That addon isn't running.",
    });
  });

  test("a failure in the addon is reported, not swallowed", async () => {
    const todos = frame("acme.todos", "widget", () => ({ error: "No room" }));
    await expect(
      dispatchQuickAdd("acme.todos", {
        key: "todo",
        title: "x",
        minutes: null,
      }),
    ).resolves.toEqual({ ok: false, message: "No room" });
    todos.stop();
  });

  test("the background frame is asked before any other", async () => {
    const card = frame("acme.todos", "widget", () => ({ message: "card" }));
    const hidden = frame("acme.todos", "background", () => ({
      message: "background",
    }));
    await expect(
      dispatchQuickAdd("acme.todos", {
        key: "todo",
        title: "x",
        minutes: null,
      }),
    ).resolves.toEqual({ ok: true, message: "background" });
    expect(card.heard).toEqual([]);
    card.stop();
    hidden.stop();
  });
});
