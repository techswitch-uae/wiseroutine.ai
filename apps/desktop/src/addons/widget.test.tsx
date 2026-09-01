import { render } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { testAddon } from "./fixtures";
import { seedAddons } from "./installed";
import { AddonWidgets } from "./widget";

/**
 * The rail's half of a widget-only addon.
 *
 * What jsdom can answer here is everything up to the frame's own first line:
 * whether a card is rendered at all, at what width, and whether it is visible
 * before its addon has said anything. What happens *inside* the frame it
 * cannot - the document has an opaque origin and jsdom will not run it - so
 * the reading itself is asserted in `addons/day-so-far`, and the `card` call
 * that carries it in `addons.test.tsx`.
 */

const card = (over: Record<string, unknown> = {}) =>
  testAddon({
    capabilities: [
      { kind: "ui:widget" },
      { kind: "read:schedule", scope: "today" },
    ],
    activityTypes: [],
    widgets: [{ key: "progress", name: "Day so far" }],
    ...over,
  });

beforeEach(() => seedAddons([]));

test("draws nothing at all when no addon contributes a card", () => {
  const { container } = render(<AddonWidgets />);
  expect(container.innerHTML).toBe("");
});

/**
 * An addon that only contributes a card, which is the shape most community
 * addons will have. It declares no activity type, and the rail neither knows
 * nor cares.
 */
test("gives a widget-only addon a frame in the rail", () => {
  seedAddons([card()]);
  const { container } = render(<AddonWidgets />);
  const frame = container.querySelector("iframe");
  expect(frame?.title).toBe("Day so far");
});

/**
 * Mounted, laid out, and not on screen.
 *
 * All three at once, and the middle one is the trap. The frame has to run to
 * decide whether there is a card at all, so it cannot be skipped. But
 * `display: none` gives it no width - so an addon measuring its own content
 * measures it wrapped one word per line and asks for a card three times too
 * tall, which is exactly what happened. Collapsing the card rather than
 * skipping it keeps the measured width the drawn width.
 */
test("keeps the card collapsed until the addon asks to be shown", () => {
  seedAddons([card()]);
  const { container } = render(<AddonWidgets />);

  const hidden = container.firstElementChild as HTMLElement;
  expect(hidden.style.height).toBe("0px");
  expect(hidden.style.visibility).toBe("hidden");
  // Not `display: none`, whatever else is true.
  expect(hidden.style.display).not.toBe("none");
  expect(container.querySelector("iframe")).toBeTruthy();
});

/**
 * Switching an addon off takes its card with it, and this is the whole of the
 * mechanism: `loadAddons` only ever puts an enabled, unrevoked addon into the
 * store, so a disabled one is simply absent on the next load. There is no
 * second flag for the rail to read and get out of step with.
 */
test("a switched-off addon leaves no card behind", () => {
  seedAddons([card()]);
  const { container, rerender } = render(<AddonWidgets />);
  expect(container.querySelector("iframe")).toBeTruthy();

  seedAddons([]);
  rerender(<AddonWidgets />);
  expect(container.innerHTML).toBe("");
});

/** Two addons may each call their card `progress`. They are two cards, and
 *  the namespaced key is what keeps them apart. */
test("keys cards by their addon, not by their bare name", () => {
  seedAddons([card(), card({ id: "acme.other", name: "Acme Other" })]);
  const { container } = render(<AddonWidgets />);
  expect(container.querySelectorAll("iframe")).toHaveLength(2);
});

/** An addon may contribute a session *and* a card. The rail draws the card
 *  and ignores the rest; `addonModules` does the opposite. */
test("draws the card of an addon that also defines a session", () => {
  seedAddons([
    testAddon({
      capabilities: [{ kind: "ui:session" }, { kind: "ui:widget" }],
      widgets: [{ key: "next-workout", name: "Next workout" }],
    }),
  ]);
  const { container } = render(<AddonWidgets />);
  expect(container.querySelector("iframe")?.title).toBe("Next workout");
});
