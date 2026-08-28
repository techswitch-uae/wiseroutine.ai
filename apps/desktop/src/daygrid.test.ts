import {
  type DayScale,
  dropAt,
  layoutDay,
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
