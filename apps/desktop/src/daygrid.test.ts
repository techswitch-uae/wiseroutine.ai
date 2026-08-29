import {
  atOf,
  DAY_DENSITIES,
  type DayDensity,
  type DayScale,
  DEFAULT_DENSITY,
  densityOf,
  dropAt,
  EDGE_ZONE,
  edgeScroll,
  floorMinutes,
  layoutDay,
  MAX_SCROLL_SPEED,
  SNAP_MINUTES,
  scaleFor,
  snap,
  yOf,
} from "@wiseroutine/design";
import { describe, expect, test } from "vitest";

/**
 * The layout is the part that has to be right.
 *
 * Here rather than in the design package because that is where the kit's tests
 * live - `design.test.tsx` is its neighbour, and neither needs a second test
 * runner in a package that has none.
 *
 * A drag consults it on every pointer move to decide where the drop lands, so
 * everything here is a rule the user can see: how tall a block is, which column
 * it takes, and where releasing it puts it. None of it needs a browser, which
 * is the point - a browser is a terrible place to discover that a slot went to
 * the wrong time.
 */

const MIN = 60_000;
/** Nine in the morning, fixed, so nothing here moves with the clock. */
const NINE = Date.UTC(2026, 7, 27, 9, 0, 0);

/** Four pixels a minute - a quarter-hour is 64px, the shipped default. */
const SCALE: DayScale = {
  dayStart: NINE,
  pxPerMinute: 64 / 15,
  minHeight: 46,
};

const at = (minutes: number) => NINE + minutes * MIN;

const block = (key: string, from: number, to: number) => ({
  key,
  startsAt: at(from),
  endsAt: at(to),
});

/** The layout, keyed by block, for readable assertions. */
const layout = (blocks: ReturnType<typeof block>[], scale = SCALE) =>
  Object.fromEntries(
    layoutDay(blocks, scale).map((placed) => [placed.block.key, placed]),
  );

describe("height", () => {
  test("a block is exactly as tall as it is long, above the floor", () => {
    const out = layout([block("hour", 0, 60), block("quarter", 120, 135)]);
    expect(out.hour?.height).toBeCloseTo(256);
    expect(out.quarter?.height).toBeCloseTo(64);
  });

  test("a block too short to read is drawn at the floor instead", () => {
    // Five minutes is 21px at this scale, which is not a thing anyone can read
    // or take hold of. Legibility wins at the bottom end and only there.
    const out = layout([block("water", 0, 5), block("eyes", 120, 130)]);
    expect(out.water?.height).toBe(SCALE.minHeight);
    expect(out.eyes?.height).toBe(SCALE.minHeight);
  });

  test("the floor never moves a block's top", () => {
    // Growing downward is free; growing upward would put a block at a time it
    // does not start at, which is the one thing height must never do.
    const out = layout([block("water", 45, 50)]);
    expect(out.water?.top).toBeCloseTo(yOf(at(45), SCALE));
  });
});

describe("columns", () => {
  test("things at the same time take a column each, shortest on the left", () => {
    // The case from the report: drop a ten-minute block onto a five and a
    // thirty, and it belongs between them.
    const out = layout([
      block("thirty", 0, 30),
      block("five", 0, 5),
      block("ten", 0, 10),
    ]);
    expect(out.five?.column).toBe(0);
    expect(out.ten?.column).toBe(1);
    expect(out.thirty?.column).toBe(2);
    expect(out.five?.columns).toBe(3);
  });

  test("ordering is by length, not by when the drag happens to be", () => {
    // The whole reason columns are ordered by length: a block being dragged
    // changes its start on every pointer move, and a preview that slid between
    // columns as it moved would be a promise the drop could not keep.
    const early = layout([
      block("thirty", 0, 30),
      block("five", 2, 7),
      block("ten", 0, 10),
    ]);
    const later = layout([
      block("thirty", 0, 30),
      block("five", 2, 7),
      block("ten", 8, 18),
    ]);
    expect(early.ten?.column).toBe(later.ten?.column);
  });

  test("a partial overlap still splits, and the ones that clear it do not", () => {
    // Two blocks overlapping for five minutes are two blocks, and the third an
    // hour later has the day to itself.
    const out = layout([
      block("first", 0, 30),
      block("second", 25, 55),
      block("alone", 120, 150),
    ]);
    expect(out.first?.column).not.toBe(out.second?.column);
    expect(out.alone?.columns).toBe(1);
    expect(out.alone?.span).toBe(1);
  });

  test("overlap is judged on what is drawn, not on the times", () => {
    // Two five-minute blocks six minutes apart do not overlap in the day, and
    // very much do on the screen once both are drawn at the floor height. A
    // layout that consulted the times would stack them.
    const out = layout([block("a", 0, 5), block("b", 6, 11)]);
    expect(out.a?.column).not.toBe(out.b?.column);
  });

  test("a block with nothing beside it keeps the whole width", () => {
    // Without widening, one clash at ten in the morning halves every block in
    // the cluster, which reads as a column layout the day does not have.
    const out = layout([
      block("long", 0, 120),
      block("clash-a", 0, 20),
      block("clash-b", 0, 20),
    ]);
    expect(out.long?.columns).toBe(3);
    // The two short ones clear out after twenty minutes; the long one is beside
    // them for that stretch and cannot widen through them.
    expect(out.long?.span).toBe(1);
    expect(out["clash-a"]?.span).toBe(1);
  });

  test("the same day always lays out the same way", () => {
    const day = [block("b", 0, 20), block("a", 0, 20), block("c", 0, 20)];
    const once = layout(day);
    const again = layout([...day].reverse());
    for (const key of ["a", "b", "c"]) {
      expect(again[key]?.column).toBe(once[key]?.column);
    }
  });
});

describe("dropping", () => {
  const dayEnd = at(600);

  test("a drop lands on the five-minute ruler", () => {
    const dropped = dropAt(
      yOf(at(37), SCALE),
      block("x", 0, 10),
      SCALE,
      dayEnd,
    );
    expect(dropped.startsAt).toBe(at(35));
  });

  test("a drop keeps the block's length", () => {
    const dropped = dropAt(
      yOf(at(90), SCALE),
      block("x", 0, 25),
      SCALE,
      dayEnd,
    );
    expect(dropped.endsAt - dropped.startsAt).toBe(25 * MIN);
  });

  test("a block cannot be dragged off either end of the day", () => {
    const twentyFive = block("x", 0, 25);
    expect(dropAt(-4000, twentyFive, SCALE, dayEnd).startsAt).toBe(at(0));
    expect(dropAt(999_999, twentyFive, SCALE, dayEnd).startsAt).toBe(at(575));
  });

  test("pixels and minutes round-trip", () => {
    // The drag's whole geometry is these two functions being each other's
    // inverse. If they drift, a block lands where it was not dropped. Stops
    // short of the day's end, where the clamp above takes over and is supposed
    // to break the round trip.
    for (const minutes of [0, 5, 37, 123, 585]) {
      const dropped = dropAt(
        yOf(at(minutes), SCALE),
        block("x", 0, 10),
        SCALE,
        dayEnd,
      );
      expect(dropped.startsAt).toBe(snap(at(minutes)));
    }
  });
});

/**
 * Two identical blocks, one dragged across the other.
 *
 * The reported bug, and it was not about columns at all: the layout used to
 * hand blocks back in drawn order, so crossing another block changed this
 * one's place in the list, React moved the DOM node to match, and moving a node
 * releases its pointer capture. The drag froze at the crossing. It only showed
 * up for blocks whose order could change - two of the same length, passing each
 * other - which is exactly what made it look like a bug about identical slots.
 */
describe("two of the same, crossing", () => {
  const twins = (draggedFrom: number) => [
    block("dragged", draggedFrom, draggedFrom + 5),
    block("still", 30, 35),
  ];

  test("the order out is the order in, wherever the blocks are", () => {
    // The fix. Blocks are positioned absolutely, so this array decides nothing
    // about what is seen - and everything about whether React reorders the DOM
    // under a live drag.
    for (const from of [0, 25, 30, 35, 60]) {
      expect(layoutDay(twins(from), SCALE).map((p) => p.block.key)).toEqual([
        "dragged",
        "still",
      ]);
    }
  });

  test("neither one changes column as they pass", () => {
    // Same length means the only thing left to order them by is position, and
    // position is the one thing a drag changes. They would have traded columns
    // the instant one crossed the other.
    const above = layout(twins(25));
    const across = layout(twins(30));
    const below = layout(twins(33));

    expect(above.dragged?.column).toBe(across.dragged?.column);
    expect(across.dragged?.column).toBe(below.dragged?.column);
    expect(above.still?.column).toBe(below.still?.column);
  });

  test("they still take a column each while they overlap", () => {
    const out = layout(twins(32));
    expect(out.dragged?.column).not.toBe(out.still?.column);
    expect(out.dragged?.columns).toBe(2);
  });
});

/**
 * Scrolling the day along with the drag.
 *
 * The browser will not do this: it auto-scrolls for its own native drags and
 * for a text selection being swept, and this is deliberately neither - so
 * without it a block simply stops at the edge of the screen with more day
 * underneath it.
 */
describe("scrolling at the edges", () => {
  const bounds = { top: 100, bottom: 500 };

  test("nothing happens in the middle", () => {
    expect(edgeScroll(300, bounds)).toBe(0);
    // Just outside the zone at both ends, so the zone's own edge is covered.
    expect(edgeScroll(100 + EDGE_ZONE, bounds)).toBe(0);
    expect(edgeScroll(500 - EDGE_ZONE, bounds)).toBe(0);
  });

  test("it scrolls towards whichever edge the pointer is near", () => {
    expect(edgeScroll(110, bounds)).toBeLessThan(0);
    expect(edgeScroll(490, bounds)).toBeGreaterThan(0);
  });

  test("gentler at the edge of the zone than on the edge itself", () => {
    const entering = edgeScroll(500 - EDGE_ZONE + 1, bounds);
    const arrived = edgeScroll(500, bounds);
    expect(entering).toBeGreaterThan(0);
    expect(arrived).toBeGreaterThan(entering);
    expect(arrived).toBeLessThanOrEqual(MAX_SCROLL_SPEED);
  });

  test("a pointer dragged clean off the container keeps it scrolling", () => {
    // Capped rather than accelerating away, and emphatically not zero: the
    // moment it most needs to scroll is the moment the pointer has run out of
    // screen and stopped moving.
    expect(edgeScroll(900, bounds)).toBe(MAX_SCROLL_SPEED);
    expect(edgeScroll(-400, bounds)).toBe(-MAX_SCROLL_SPEED);
  });
});

/**
 * Density, and the invariants every preset has to satisfy.
 *
 * Written against the whole list rather than against one preset on purpose.
 * The point of these is not that today's three numbers are right - it is that a
 * fourth preset added in six months cannot quietly break dragging, or produce a
 * day where most blocks are drawn at a lie. Each of these fails on the preset
 * that broke it, by name.
 */
const DAY = Date.UTC(2026, 0, 5, 8, 0, 0, 0);
const DAY_END = DAY + 10 * 3_600_000;
const each = (run: (density: DayDensity) => void) => {
  for (const density of DAY_DENSITIES) {
    // Named so a failure says which preset, not just which assertion.
    test(`${density.key}`, () => run(density));
  }
};

describe("every density is a usable surface", () => {
  each((density) => {
    const scale = scaleFor(density, DAY);
    expect(scale.pxPerMinute).toBeGreaterThan(0);
    expect(scale.minHeight).toBeGreaterThan(0);
    expect(scale.dayStart).toBe(DAY);
    // A card below about thirty pixels cannot be read or grabbed, whatever the
    // day is zoomed to.
    expect(density.minBlockHeight).toBeGreaterThanOrEqual(30);
  });
});

describe("a snap step is always big enough to aim at", () => {
  each((density) => {
    // The ruler is five minutes. If a step is a couple of pixels the block
    // jumps between two of them and lands wherever the hand shook.
    const step = SNAP_MINUTES * scaleFor(density, DAY).pxPerMinute;
    expect(step).toBeGreaterThanOrEqual(8);
  });
});

describe("most of the day is drawn at its true height", () => {
  each((density) => {
    // Below this many minutes a block sits on the floor instead of its
    // duration. Let it grow and a compact day becomes a column of identical
    // cards that all claim to be the same length.
    expect(floorMinutes(density)).toBeLessThanOrEqual(15);
    // And the floor has to actually bind, or `minHeight` is doing nothing and
    // five-minute blocks are four pixels tall.
    expect(floorMinutes(density)).toBeGreaterThan(SNAP_MINUTES);
  });
});

describe("pixels and instants round-trip", () => {
  each((density) => {
    const scale = scaleFor(density, DAY);
    // A drag converts both ways on every pointer move. If these disagree the
    // block drifts under the cursor.
    for (const minutes of [0, 5, 37, 240, 599]) {
      const at = DAY + minutes * 60_000;
      expect(atOf(yOf(at, scale), scale)).toBeCloseTo(at, 6);
    }
  });
});

describe("a drop keeps its length and stays inside the day", () => {
  each((density) => {
    const scale = scaleFor(density, DAY);
    const block = {
      key: "a",
      startsAt: DAY + 60 * 60_000,
      endsAt: DAY + 90 * 60_000,
    };
    const length = block.endsAt - block.startsAt;

    // Well past both ends, and everywhere sensible in between.
    for (const y of [-9999, -1, 0, 37, 250, 999, 99_999]) {
      const drop = dropAt(y, block, scale, DAY_END);
      expect(drop.endsAt - drop.startsAt).toBe(length);
      expect(drop.startsAt).toBeGreaterThanOrEqual(DAY);
      expect(drop.endsAt).toBeLessThanOrEqual(DAY_END);
      // And always on the ruler, so it cannot land between two lines.
      expect(drop.startsAt).toBe(snap(drop.startsAt));
    }
  });
});

describe("dragging a block to where it already is leaves it there", () => {
  each((density) => {
    const scale = scaleFor(density, DAY);
    const block = {
      key: "a",
      startsAt: DAY + 65 * 60_000,
      endsAt: DAY + 95 * 60_000,
    };
    // Picked up and put down without moving. A scale that rounded badly would
    // shift it by a step every time it was touched.
    const drop = dropAt(yOf(block.startsAt, scale), block, scale, DAY_END);
    expect(drop.startsAt).toBe(block.startsAt);
    expect(drop.endsAt).toBe(block.endsAt);
  });
});

describe("the same day lays out the same way at every density", () => {
  each((density) => {
    // Density changes how tall the day is, never what overlaps what. Three
    // blocks: two clashing, one clear.
    const blocks = [
      { key: "a", startsAt: DAY, endsAt: DAY + 60 * 60_000 },
      { key: "b", startsAt: DAY + 30 * 60_000, endsAt: DAY + 90 * 60_000 },
      { key: "c", startsAt: DAY + 5 * 3_600_000, endsAt: DAY + 6 * 3_600_000 },
    ];
    const placed = layoutDay(blocks, scaleFor(density, DAY));
    const by = (key: string) =>
      placed.find((p) => p.block.key === key) as (typeof placed)[number];

    expect(by("a").columns).toBe(2);
    expect(by("b").columns).toBe(2);
    expect(by("a").column).not.toBe(by("b").column);
    // The afternoon block is alone, so one clash in the morning must not
    // narrow it.
    expect(by("c").columns).toBe(1);
    expect(by("c").span).toBe(1);
  });
});

describe("blocks keep their order down the day at every density", () => {
  each((density) => {
    const scale = scaleFor(density, DAY);
    const earlier = { key: "a", startsAt: DAY, endsAt: DAY + 30 * 60_000 };
    const later = {
      key: "b",
      startsAt: DAY + 30 * 60_000,
      endsAt: DAY + 60 * 60_000,
    };
    // Whatever the scale, later is lower. A negative or zero pxPerMinute would
    // invert the day, and nothing else here would notice.
    expect(yOf(later.startsAt, scale)).toBeGreaterThan(
      yOf(earlier.startsAt, scale),
    );
  });
});

describe("densityOf", () => {
  test("finds a preset by key", () => {
    expect(densityOf("compact").key).toBe("compact");
    expect(densityOf("roomy").key).toBe("roomy");
  });

  test("falls back for anything storage can hand back", () => {
    // These are not hypothetical: the value comes from localStorage, which is
    // empty on a first run and editable by hand thereafter.
    for (const junk of [null, undefined, "", "  ", "COMPACT", "medium", "{}"]) {
      expect(densityOf(junk).key).toBe(DEFAULT_DENSITY);
    }
  });

  test("the default is a real preset", () => {
    // A renamed preset would otherwise leave the fallback pointing at nothing.
    expect(DAY_DENSITIES.some((d) => d.key === DEFAULT_DENSITY)).toBe(true);
  });

  test("keys are unique, so a lookup cannot be ambiguous", () => {
    const keys = DAY_DENSITIES.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("denser presets really are denser", () => {
    // The list is the menu's order, so it has to read as an ordering.
    const steps = DAY_DENSITIES.map((d) => d.quarterStep);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});
