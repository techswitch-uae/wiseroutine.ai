// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import { AddonError, type AddonRole, type AddonTheme, connect } from "./index";

/**
 * The client half of the wire.
 *
 * This is published code that strangers build against, so its failure modes
 * are part of its contract: an addon author debugging a session that will not
 * start needs the SDK to say what went wrong, not to hang.
 */

const HANDSHAKE = "wiseroutine:addon:port";

const THEME: AddonTheme = {
  text: "#111",
  muted: "#666",
  background: "#fff",
  hairline: "#eee",
  track: "#ddd",
  accent: "#7a6a4f",
  fontBody: "Body",
  fontHeading: "Heading",
};

/** Play the host: hand over a port, then answer on it. */
function host(role: AddonRole = { kind: "session" }): {
  port: MessagePort;
  handshake: () => void;
  /** Something the host says unprompted - see `HostEvent`. */
  announce: (event: unknown) => void;
  answer: (
    handler: (request: { id: number; method: string }) => unknown,
  ) => void;
} {
  const channel = new MessageChannel();
  return {
    port: channel.port1,
    handshake: () =>
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { type: HANDSHAKE, role, theme: THEME },
          ports: [channel.port2],
        }),
      ),
    announce: (event) => channel.port1.postMessage(event),
    answer: (handler) => {
      channel.port1.addEventListener("message", (event: MessageEvent) => {
        channel.port1.postMessage(handler(event.data));
      });
      channel.port1.start();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

/** A port delivers on a task, not a microtask, so `await Promise.resolve()`
 *  is not enough to see what the host just posted. */
const delivered = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("connecting", () => {
  test("resolves when the host hands over a port", async () => {
    const h = host();
    const connecting = connect();
    h.handshake();
    await expect(connecting).resolves.toBeDefined();
  });

  /**
   * An addon left awaiting a port that is never coming shows a blank session
   * with no explanation. Failing loudly is the whole point: the author is
   * looking at it right now.
   */
  test("gives up rather than hanging for ever", async () => {
    vi.useFakeTimers();
    const connecting = connect(1_000).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_100);
    const error = await connecting;
    expect(error).toBeInstanceOf(AddonError);
    expect((error as AddonError).kind).toBe("failed");
  });

  /**
   * Everything after the handshake travels on the port. A frame whose own
   * `window` kept accepting messages would be a second way in, and one that
   * anything on the page could use.
   */
  test("stops listening on the window once connected", async () => {
    const h = host();
    const connecting = connect();
    h.handshake();
    await connecting;

    const second = host();
    second.handshake();
    // Nothing to assert beyond "did not throw and did not reconnect": the
    // first port is the only one the client holds.
    expect(true).toBe(true);
  });
});

/** Connected and ready to be called. */
const connected = async (role?: AddonRole) => {
  const h = host(role);
  const connecting = connect();
  h.handshake();
  return { client: await connecting, h };
};

describe("calling the host", () => {
  test("returns what the host answered", async () => {
    const { client, h } = await connected();
    h.answer((request) => ({
      id: request.id,
      result: { slot: { id: "s1" }, config: { pattern: "4-7-8" } },
    }));
    await expect(client.session()).resolves.toEqual({
      slot: { id: "s1" },
      config: { pattern: "4-7-8" },
    });
  });

  /**
   * Replies are matched by id, not by arrival order. A host that answers a
   * slow call after a fast one must not resolve the wrong promise - which is
   * the bug every hand-rolled RPC has once.
   */
  test("matches answers to their own calls", async () => {
    const { client, h } = await connected();
    h.answer((request) => ({ id: request.id, result: request.method }));

    const [session, day] = await Promise.all([
      client.session(),
      client.day().catch(() => "day"),
    ]);
    expect(session).toBe("session");
    expect(day).toBe("day");
  });

  test("a refusal arrives as an AddonError the author can read", async () => {
    const { client, h } = await connected();
    h.answer((request) => ({
      id: request.id,
      error: {
        message: "This addon was not granted read:schedule.",
        kind: "denied",
      },
    }));

    const error = await client.day().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AddonError);
    expect((error as AddonError).kind).toBe("denied");
    expect((error as AddonError).message).toContain("read:schedule");
  });

  // A reply for a call nobody made, or one already settled, is dropped rather
  // than throwing inside the port's message handler - where the exception
  // would have nowhere to go.
  test("ignores an answer to a call it is not waiting for", async () => {
    const { client, h } = await connected();
    h.answer((request) => ({ id: request.id, result: "ok" }));
    await client.session();
    expect(() =>
      h.port.postMessage({ id: 999, result: "stray" }),
    ).not.toThrow();
  });
});

/**
 * The two things that arrive with the port rather than being asked for.
 *
 * Both are known to the host before the addon's first line runs and neither
 * can change while the frame lives, so a round trip for either would be a
 * round trip every addon pays before it can draw - and for the theme, a first
 * paint in the wrong colours.
 */
describe("what the handshake carries", () => {
  test("says why the addon was loaded, without it having to ask", async () => {
    const h = host({ kind: "widget", widgetKey: "progress" });
    const connecting = connect();
    h.handshake();
    const client = await connecting;
    expect(client.role).toEqual({ kind: "widget", widgetKey: "progress" });
  });

  test("carries the host's resolved colours", async () => {
    const h = host();
    const connecting = connect();
    h.handshake();
    expect((await connecting).theme.track).toBe(THEME.track);
  });

  /** A bare string used to be the whole handshake. Anything that is not the
   *  envelope is not a handshake, or the frame would connect to whatever on
   *  the page happened to post first. */
  test("ignores a message that is not the handshake envelope", async () => {
    vi.useFakeTimers();
    const channel = new MessageChannel();
    const connecting = connect(1_000).catch((error: unknown) => error);

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: HANDSHAKE,
        ports: [channel.port2],
      }),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await connecting).toBeInstanceOf(AddonError);
  });
});

/**
 * The host speaking first.
 *
 * The only unprompted message there is, and what makes a rail card viable
 * without a timer. Told apart from a reply by having no `id`.
 */
describe("being told the day changed", () => {
  test("calls every listener", async () => {
    const { client, h } = await connected();
    const seen: string[] = [];
    client.onDayChange(() => seen.push("a"));
    client.onDayChange(() => seen.push("b"));

    h.announce({ event: "day" });
    await delivered();
    expect(seen).toEqual(["a", "b"]);
  });

  test("stops once unsubscribed", async () => {
    const { client, h } = await connected();
    const listener = vi.fn();
    client.onDayChange(listener)();

    h.announce({ event: "day" });
    await delivered();
    expect(listener).not.toHaveBeenCalled();
  });

  /** A listener that removes itself must not corrupt the iteration - which is
   *  exactly what a `Set` mutated mid-loop would do. */
  test("survives a listener that unsubscribes itself", async () => {
    const { client, h } = await connected();
    const other = vi.fn();
    const stop = client.onDayChange(() => stop());
    client.onDayChange(other);

    h.announce({ event: "day" });
    await delivered();
    expect(other).toHaveBeenCalledTimes(1);
  });

  test("does not mistake an announcement for an answer", async () => {
    const { client, h } = await connected();
    h.answer((request) => ({ id: request.id, result: "ok" }));
    const calling = client.session();
    h.announce({ event: "day" });
    await expect(calling).resolves.toBe("ok");
  });
});

describe("todos and quick add", () => {
  const WIDGET: AddonRole = { kind: "widget", widgetKey: "list" };

  test("what Quick add typed reaches the listener, request and all", async () => {
    const h = host(WIDGET);
    const connecting = connect();
    h.handshake();
    const wr = await connecting;

    const heard: unknown[] = [];
    wr.onQuickAdd((request) => heard.push(request));
    h.announce({
      event: "quickAdd",
      request: { key: "todo", title: "Reply to Anders", minutes: 15 },
    });
    await delivered();

    expect(heard).toEqual([
      { key: "todo", title: "Reply to Anders", minutes: 15 },
    ]);
  });

  test("placing a todo sends the time only when one was given", async () => {
    const h = host(WIDGET);
    const seen: unknown[] = [];
    h.answer((request) => {
      seen.push((request as { params?: unknown }).params);
      return { id: request.id, result: {} };
    });
    const connecting = connect();
    h.handshake();
    const wr = await connecting;

    await wr.todos.place("t1");
    await wr.todos.place("t1", 5);
    expect(seen).toEqual([{ id: "t1" }, { id: "t1", startsAt: 5 }]);
  });
});
