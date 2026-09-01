import { render } from "@testing-library/react";
import type { AddonManifest } from "@wiseroutine/addons";
import { parseManifest } from "@wiseroutine/addons";
import { describe, expect, test } from "vitest";
import { AddonFrame } from "./frame";
import { type AddonContext, serve } from "./host";

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

const SESSION: AddonContext = {
  kind: "session",
  slot: { id: "s1", title: "Breathing", startsAt: 0, endsAt: 60_000 },
  config: { pattern: "4-7-8" },
};

/**
 * Talk to the host the way an addon does, and get the raw reply.
 *
 * Deliberately not the SDK client: the SDK is what a *co-operating* addon
 * uses, and a test of the boundary must be able to send things the SDK would
 * never send.
 */
function connectTo(
  addon: AddonManifest,
  context: AddonContext = SESSION,
): {
  call: (method: string, params?: unknown) => Promise<unknown>;
  stop: () => void;
} {
  const channel = new MessageChannel();
  const stop = serve(channel.port1, addon, context);
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
      <AddonFrame
        title="Session"
        manifest={addon}
        bundle="/* addon */"
        context={SESSION}
      />,
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

  test("an addon may reach exactly the origins it declared", () => {
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
        manifest={manifest()}
        bundle={
          '</script><meta http-equiv="Content-Security-Policy" content="">'
        }
        context={SESSION}
      />,
    );
    const html =
      container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
    expect(html).not.toContain("</script><meta");
    expect(html).toContain("<\\/script>");
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
    expect(reply.result).toEqual({
      slot: SESSION.slot,
      config: SESSION.config,
    });
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
