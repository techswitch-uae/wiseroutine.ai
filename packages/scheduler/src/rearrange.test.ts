import { describe, expect, it } from "vitest";
import type { Relocation } from "./rearrange";
import {
  AUTO_DRIFT_MS,
  DEFAULT_BREATHER,
  MIN_SIBLING_GAP_MS,
  NO_BREATHER,
  rearrange,
  resolveBreather,
} from "./rearrange";
import type { Scenario } from "./scenarios";
import { clockOf, runScenario, SCENARIOS } from "./scenarios";
import type { Interval } from "./types";

/**
 * Two kinds of test, and the split is the point.
 *
 * The invariants hold for every scenario, forever, whatever we decide a good
 * repair looks like: never on top of a meeting, never on top of another slot,
 * never in the past, never a slot nothing landed on. Those are correctness,
 * and they run against all of them at once - which is what makes adding a
 * scenario cheap and worth doing.
 *
 * The expectations are the other half: what we *decided*, one scenario at a
 * time, by looking at it in the simulator. They are exact and complete, so a
 * rule change that quietly shifts a placement by five minutes fails here
 * rather than shipping. A scenario with no `expect` is a question still open.
 */

const overlaps = (a: Interval, b: Interval): boolean =>
  a.start < b.end && b.start < a.end;

const placements = (r: {
  moved: Relocation[];
  suggested: Relocation[];
}): Relocation[] => [...r.moved, ...r.suggested];

const byId = <T extends unknown[]>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));

describe("scenario corpus", () => {
  it("has unique ids", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is fully settled", () => {
    const open = SCENARIOS.filter((s) => !s.expect).map((s) => s.id);
    expect(open).toEqual([]);
  });

  for (const scenario of SCENARIOS) {
    describe(scenario.id, () => {
      const built = runScenario(scenario);
      const { result } = built;
      const placed = placements(result);
      const at = (i: Interval) => clockOf(i.start, built.timeZone);

      it("never places a slot on top of a meeting", () => {
        for (const move of placed) {
          const hit = built.busyAfter.find((b) => overlaps(move.to, b));
          expect(hit && { slot: move.slotId, at: at(move.to) }).toBeUndefined();
        }
      });

      it("never places two slots on top of each other", () => {
        const held: Interval[] = built.slots
          .filter(
            (s) =>
              s.status !== "cancelled" &&
              s.status !== "skipped" &&
              s.status !== "missed" &&
              !placed.some((p) => p.slotId === s.id),
          )
          .map((s) => ({ start: s.start, end: s.end }));
        for (const move of placed) {
          expect(held.find((h) => overlaps(move.to, h))).toBeUndefined();
          held.push(move.to);
        }
      });

      it("never places anything in the past or outside the day", () => {
        for (const move of placed) {
          expect(move.to.start).toBeGreaterThanOrEqual(
            Math.max(built.now, built.dayStart),
          );
          expect(move.to.end).toBeLessThanOrEqual(built.dayEnd);
        }
      });

      it("keeps the length of every slot it moves", () => {
        for (const move of placed) {
          expect(move.to.end - move.to.start).toBe(
            move.from.end - move.from.start,
          );
        }
      });

      it("only touches slots a meeting actually landed on", () => {
        const moved = placed.map((m) => m.slotId).sort();
        const collided = built.slots
          .filter((s) => built.busyAfter.some((b) => overlaps(s, b)))
          .map((s) => s.id);
        expect(moved.filter((id) => !collided.includes(id))).toEqual([]);
      });

      it("honours the spacing floor between sessions of one activity", () => {
        // The one hard rule in the engine. A violation here is the difference
        // between four eye rests and one eye rest with three interruptions.
        const bySibling = new Map<string, Interval[]>();
        for (const slot of built.slots) {
          if (
            slot.status === "cancelled" ||
            slot.status === "skipped" ||
            slot.status === "missed"
          ) {
            continue;
          }
          const move = placed.find((p) => p.slotId === slot.id);
          if (result.blocked.some((b) => b.slotId === slot.id)) continue;
          bySibling.set(slot.activityId, [
            ...(bySibling.get(slot.activityId) ?? []),
            move ? move.to : { start: slot.start, end: slot.end },
          ]);
        }
        for (const [activityId, list] of bySibling) {
          const order = [...list].sort((a, b) => a.start - b.start);
          for (let i = 1; i < order.length; i++) {
            const previous = order[i - 1] as Interval;
            const next = order[i] as Interval;
            expect({
              activityId,
              tooClose: next.start - previous.end < MIN_SIBLING_GAP_MS,
            }).toEqual({ activityId, tooClose: false });
          }
        }
      });

      it("is deterministic", () => {
        expect(rearrange(built.input)).toEqual(result);
      });

      it("agrees with itself about which reasons it gave", () => {
        // `moved` means nothing to ask about; `suggested` means at least one
        // thing. A relocation in the wrong list is a silent change of policy.
        for (const move of result.moved) expect(move.reasons).toEqual([]);
        for (const move of result.suggested) {
          expect(move.reasons.length).toBeGreaterThan(0);
        }
      });

      it("reports every slot exactly once", () => {
        const seen = [
          ...placed.map((p) => p.slotId),
          ...result.blocked.map((b) => b.slotId),
          ...result.kept,
          ...result.frozenConflicts,
        ];
        expect(new Set(seen).size).toBe(seen.length);

        // Every movable slot with time left on the day gets exactly one
        // answer. Frozen and past slots are the only silences allowed, and
        // they are silent only when nothing collided with them.
        const owed = built.slots
          .filter(
            (s) =>
              s.status === "planned" &&
              s.start >= built.now &&
              s.end > built.now,
          )
          .map((s) => s.id)
          .sort();
        expect(owed.filter((id) => !seen.includes(id))).toEqual([]);
      });

      const expected = (scenario as Scenario).expect;
      if (!expected) return;

      it("matches the settled outcome", () => {
        expect({
          moved: byId(result.moved.map((m) => [m.slotId, at(m.to)])),
          suggested: byId(
            result.suggested.map((m) => [m.slotId, at(m.to), m.reasons]),
          ),
          blocked: byId(result.blocked.map((b) => [b.slotId, b.reason])),
          frozen: [...result.frozenConflicts].sort(),
        }).toEqual({
          moved: byId(expected.moved ?? []),
          suggested: byId(expected.suggested ?? []),
          blocked: byId(expected.blocked ?? []),
          frozen: [...(expected.frozen ?? [])].sort(),
        });
      });
    });
  }
});

/**
 * The rules themselves, away from any particular day.
 *
 * The corpus proves the engine behaves on fifty-odd real situations. These
 * prove the constants mean what the names say, which is what stops a future
 * "just bump the breather" from passing because every scenario happened to be
 * insensitive to it.
 */
describe("rules", () => {
  const day: [string, string] = ["08:00", "18:00"];

  const oneSlot = (over: Partial<Scenario>): Scenario => ({
    id: "unit",
    title: "unit",
    probes: "unit",
    tags: [],
    day,
    now: "08:00",
    activities: [
      { id: "a", name: "A", kind: "focus", sessionMinutes: 30 },
      ...(over.activities ?? []),
    ],
    events: [],
    slots: [{ id: "s1", activityId: "a", start: "10:00" }],
    changes: [],
    ...over,
  });

  it("gives a short meeting the short breather", () => {
    const built = runScenario(
      oneSlot({
        events: [
          { id: "m", title: "Short", start: "09:30", end: "10:00" },
          { id: "wall", title: "Wall", start: "13:00", end: "18:00" },
        ],
        changes: [{ op: "resize", eventId: "m", end: "10:10" }],
      }),
    );
    const move = built.result.moved[0];
    expect(move && clockOf(move.to.start, built.timeZone)).toBe("10:15");
    expect(DEFAULT_BREATHER.minutes).toBe(5);
  });

  it("gives a long meeting the long breather", () => {
    const built = runScenario(
      oneSlot({
        events: [
          { id: "m", title: "Long", start: "09:00", end: "10:00" },
          { id: "wall", title: "Wall", start: "13:00", end: "18:00" },
        ],
        changes: [{ op: "resize", eventId: "m", end: "10:10" }],
      }),
    );
    const move = built.result.moved[0];
    expect(move && clockOf(move.to.start, built.timeZone)).toBe("10:20");
    expect(DEFAULT_BREATHER.longMinutes).toBe(10);
  });

  it("gives up the breather rather than the session", () => {
    const built = runScenario(
      oneSlot({
        events: [
          { id: "m", title: "Long", start: "09:00", end: "10:00" },
          { id: "wall", title: "Wall", start: "10:40", end: "18:00" },
        ],
        changes: [{ op: "resize", eventId: "m", end: "10:10" }],
      }),
    );
    const move = built.result.moved[0];
    expect(move && clockOf(move.to.start, built.timeZone)).toBe("10:10");
    expect(move?.breatherShortfallMs).toBeGreaterThan(0);
  });

  it("asks once drift passes the line, and not before", () => {
    const drift = (endsAt: string) => {
      const built = runScenario(
        oneSlot({
          events: [
            { id: "pre", title: "Pre", start: "08:00", end: "10:00" },
            { id: "m", title: "M", start: "12:00", end: "12:30" },
          ],
          // No breather is possible against a merged block that runs right up
          // to the placement, so drift is the only thing under test.
          changes: [
            { op: "resize", eventId: "m", start: "09:55", end: endsAt },
          ],
        }),
      );
      return built.result;
    };
    expect(drift("10:20").moved).toHaveLength(1);
    expect(drift("11:00").suggested).toHaveLength(1);
    expect(AUTO_DRIFT_MS).toBe(60 * 60_000);
  });

  it("never asks about drift for an activity that named a window", () => {
    const built = runScenario(
      oneSlot({
        activities: [
          {
            id: "w",
            name: "W",
            kind: "recovery",
            sessionMinutes: 15,
            windows: [["08:00", "18:00"]],
          },
        ],
        slots: [{ id: "s1", activityId: "w", start: "08:10" }],
        events: [
          { id: "m", title: "M", start: "08:00", end: "08:30" },
          { id: "wall", title: "Wall", start: "08:30", end: "16:00" },
        ],
        changes: [{ op: "resize", eventId: "m", end: "08:30" }],
      }),
    );
    const move = built.result.moved[0];
    expect(move?.driftMs).toBeGreaterThan(AUTO_DRIFT_MS);
    expect(move?.reasons).toEqual([]);
  });

  it("fills in a partial gap rule and refuses a nonsensical one", () => {
    // The rule arrives from settings, which is the edge of the system. A
    // negative gap would pay a placement to sit inside its neighbour.
    expect(resolveBreather(undefined)).toEqual(DEFAULT_BREATHER);
    expect(resolveBreather({ minutes: 15 })).toEqual({
      ...DEFAULT_BREATHER,
      minutes: 15,
    });
    expect(resolveBreather({ minutes: -5, weight: Number.NaN })).toEqual(
      DEFAULT_BREATHER,
    );
    expect(resolveBreather({ minutes: 0 }).minutes).toBe(0);
  });

  it("keeps the weight when the gap is switched off", () => {
    // Zeroing it would price every shortfall at nothing, including the one a
    // per-activity buffer creates - see `h9`.
    expect(NO_BREATHER.weight).toBe(DEFAULT_BREATHER.weight);
    expect(NO_BREATHER.minutes).toBe(0);
    expect(NO_BREATHER.longMinutes).toBe(0);
  });

  it("buckets rather than suggests when the only room crowds a sibling", () => {
    const built = runScenario(
      oneSlot({
        slots: [
          { id: "s1", activityId: "a", start: "10:00" },
          { id: "s2", activityId: "a", start: "11:00" },
        ],
        events: [
          { id: "m", title: "M", start: "08:00", end: "09:00" },
          { id: "wall", title: "Wall", start: "11:30", end: "18:00" },
        ],
        changes: [{ op: "resize", eventId: "m", end: "10:30" }],
      }),
    );
    expect(built.result.suggested).toEqual([]);
    expect(built.result.blocked.map((b) => b.reason)).toEqual(["too_close"]);
    expect(MIN_SIBLING_GAP_MS).toBe(30 * 60_000);
  });
});
