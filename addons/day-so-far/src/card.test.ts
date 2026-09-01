import type { AddonTheme, DaySlot } from "@wiseroutine/addon-sdk";
import { describe, expect, it } from "vitest";
import { fill, markup } from "./card";
import { tallyOf } from "./day";

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

const NOON = Date.UTC(2026, 8, 1, 12, 0);
const MINUTE = 60_000;

const slot = (over: Partial<DaySlot> = {}): DaySlot => ({
  id: "s",
  title: "Stretch",
  kind: "recovery",
  startsAt: NOON,
  endsAt: NOON + 30 * MINUTE,
  status: "planned",
  ownedByYou: false,
  ...over,
});

const tally = (slots: DaySlot[]) => tallyOf(slots, NOON);

describe("markup", () => {
  const html = markup(tally([slot({ status: "completed" })]), "UTC", THEME);

  /**
   * The one rule that is not a preference. The host paints the card's ground
   * behind this frame; a document with a background of its own paints the
   * browser's white over it, which is a white rectangle inside a dark card.
   */
  it("draws on a transparent ground", () => {
    expect(html).toContain("background: transparent");
  });

  it("takes its colours from the host rather than hard-coding them", () => {
    // A fixed ink here would be invisible in exactly one of the two themes,
    // and the user picked the theme.
    expect(html).toContain(THEME.text);
    expect(html).toContain(THEME.track);
    expect(html).toContain(THEME.fontHeading);
  });

  it("leaves the text to `fill`, so a redraw does not restart the bar", () => {
    // Empty elements, filled afterwards. If the headline were baked in here,
    // every change to the day would mean a new `innerHTML` - and the bar's
    // transition would start from zero each time instead of sliding.
    expect(html).toContain('<h3 class="title"></h3>');
  });
});

/**
 * A stand-in for the two DOM features `fill` uses.
 *
 * Ten lines rather than a jsdom dependency for one function: `fill` reaches
 * for `querySelector`, `textContent`, `hidden` and `style.width` and nothing
 * else, so those are what a test of it has to provide. Adding a whole browser
 * to check four assignments is the tail wagging the dog.
 */
function fakeRoot() {
  const nodes = new Map<
    string,
    { textContent: string; hidden: boolean; style: { width: string } }
  >();
  for (const selector of [
    ".title",
    ".done",
    ".ahead",
    ".count",
    ".note",
    ".fill",
  ]) {
    nodes.set(selector, {
      textContent: "",
      hidden: false,
      style: { width: "" },
    });
  }
  const root = {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
  } as unknown as ParentNode;
  return { root, at: (selector: string) => nodes.get(selector) };
}

describe("fill", () => {
  it("writes the reading into the card", () => {
    const { root, at } = fakeRoot();
    fill(
      root,
      tally([
        slot({ id: "a", status: "completed" }),
        slot({ id: "b", status: "skipped" }),
      ]),
      "UTC",
    );

    expect(at(".title")?.textContent).toBe("1 of 2 done");
    expect(at(".count")?.textContent).toBe("1 / 2");
    expect(at(".done")?.textContent).toBe("30 m done");
    expect(at(".fill")?.style.width).toBe("50%");
  });

  it("hides the footnote rather than leaving an empty line", () => {
    const { root, at } = fakeRoot();
    fill(root, tally([slot({ status: "completed" })]), "UTC");
    expect(at(".note")?.hidden).toBe(true);
    expect(at(".ahead")?.textContent).toBe("");
  });

  it("shows the footnote again once there is something to admit", () => {
    const { root, at } = fakeRoot();
    fill(
      root,
      tally([
        slot({ id: "a", status: "completed" }),
        slot({ id: "b", status: "missed" }),
      ]),
      "UTC",
    );
    expect(at(".note")?.hidden).toBe(false);
    expect(at(".note")?.textContent).toContain("1 missed");
  });
});
