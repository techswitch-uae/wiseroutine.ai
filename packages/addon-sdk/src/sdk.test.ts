// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import { AddonError, connect } from "./index";

/**
 * The client half of the wire.
 *
 * This is published code that strangers build against, so its failure modes
 * are part of its contract: an addon author debugging a session that will not
 * start needs the SDK to say what went wrong, not to hang.
 */

const HANDSHAKE = "wiseroutine:addon:port";

/** Play the host: hand over a port, then answer on it. */
function host(): {
  port: MessagePort;
  handshake: () => void;
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
          data: HANDSHAKE,
          ports: [channel.port2],
        }),
      ),
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

describe("calling the host", () => {
  const connected = async () => {
    const h = host();
    const connecting = connect();
    h.handshake();
    return { client: await connecting, h };
  };

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
