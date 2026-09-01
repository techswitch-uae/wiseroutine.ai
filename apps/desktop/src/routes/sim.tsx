/**
 * The rearrangement simulator. Temporary, and deliberately so.
 *
 * The engine in `@wiseroutine/scheduler/rearrange` makes judgement calls that
 * no test can settle: whether a morning stretch pushed to four o'clock should
 * be offered or refused, whether an eye rest that moved five hours but kept
 * its spacing is a repair or a surprise. Those need a person looking at a day
 * and saying yes or no.
 *
 * So this walks the scenario corpus one at a time - the day as it was, the day
 * after the sync, then what the engine wants to do about it - and records the
 * answer. The verdicts land in `docs/scenario-verdicts.json` through the dev
 * server (see `vite.config.ts`), which is what makes them readable outside the
 * browser and actionable in the next session.
 *
 * Once every scenario has a verdict, the confirmed ones become `expect` blocks
 * in the corpus and this page can be deleted. It is scaffolding, not product:
 * no route in the app links to it.
 */

import { createFileRoute } from "@tanstack/react-router";
import { DayGrid, type DayGridItem, Slot } from "@wiseroutine/design";
import {
  type BreatherRule,
  type BuiltScenario,
  breatherFor,
  clockOf,
  type Relocation,
  runScenario,
  SCENARIOS,
} from "@wiseroutine/scheduler";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

export const Route = createFileRoute("/sim")({ component: Sim });

/* ── Verdicts ────────────────────────────────────────────────────────────── */

type Call = "ok" | "wrong" | "unsure";

interface Verdict {
  call: Call;
  comment: string;
  /** What the engine did at the moment this was judged. A verdict whose
   *  outcome no longer matches the engine is stale, and visibly so. */
  outcome: string;
  at: string;
}

type Verdicts = Record<string, Verdict>;

const STORE = "/__verdicts";

/* ── Reading a day ───────────────────────────────────────────────────────── */

const range = (built: BuiltScenario, from: number, to: number): string =>
  `${clockOf(from, built.timeZone)}–${clockOf(to, built.timeZone)}`;

const mins = (ms: number): string => `${Math.round(ms / 60_000)}m`;

type Step = "before" | "synced" | "rearranged";

/**
 * One thing that holds time, at one step.
 *
 * Meetings and slots in the same shape on purpose: the gap rule does not care
 * which is which, so a view of the gap rule must not either.
 */
interface Block {
  key: string;
  start: number;
  end: number;
  name: string;
  isSlot: boolean;
  variant: "meeting" | "focus" | "recovery" | "live" | "suggested";
  /** The full diagnostic line. Times, length, and whatever the step has to
   *  say about this block. Rendered by the ledger, which has room for it. */
  meta: string;
  /** Just the range, for the block on the grid. */
  timeLabel: string;
  badge?: string;
}

/** Which events this scenario's change actually touched, and how. */
function changedEvents(built: BuiltScenario): Map<string, string> {
  const marks = new Map<string, string>();
  for (const change of built.scenario.changes) {
    if (change.op === "add") marks.set(change.event.id, "new");
    else if (change.op === "remove") marks.set(change.eventId, "removed");
    else marks.set(change.eventId, change.op === "move" ? "moved" : change.op);
  }
  return marks;
}

/**
 * The day at one step, as blocks.
 *
 * Only what the engine counts as busy is drawn. The version that drew
 * everything with a "not busy" tag beside it was worse than leaving it out: a
 * cancelled meeting still sitting on a slot looks exactly like a conflict the
 * engine failed to notice, and it got judged as one.
 */
function blocksAt(built: BuiltScenario, step: Step): Block[] {
  const before = step === "before";
  const events = before ? built.eventsBefore : built.eventsAfter;
  const busy = before ? built.busyBefore : built.busyAfter;
  const marks = changedEvents(built);
  const { result } = built;

  const blocks: Block[] = events
    .filter((e) => busy.some((b) => b.sourceEventIds.includes(e.id)))
    .map((event) => {
      const length = event.end - event.start;
      return {
        key: `event:${event.id}`,
        start: event.start,
        end: event.end,
        name: event.title ?? "Meeting",
        isSlot: false,
        variant: "meeting" as const,
        timeLabel: range(built, event.start, event.end),
        meta: [
          range(built, event.start, event.end),
          mins(length),
          // What the block is worth as a neighbour, spelled out - this is the
          // number the breather is sized from, and guessing it from the
          // duration is exactly the arithmetic this view exists to save.
          `wants ${mins(breatherFor(built.breather, length))} either side`,
          !before && marks.has(event.id) ? `← ${marks.get(event.id)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });

  const relocated = new Map(
    [...result.moved, ...result.suggested].map((r) => [r.slotId, r]),
  );

  for (const slot of built.slots) {
    if (
      slot.status === "cancelled" ||
      slot.status === "skipped" ||
      slot.status === "missed"
    ) {
      continue;
    }
    const activity = built.activities[slot.activityId]?.activity;
    const move = step === "rearranged" ? relocated.get(slot.id) : undefined;
    const blocked =
      step === "rearranged" && result.blocked.find((b) => b.slotId === slot.id);
    const suggested =
      move && result.suggested.some((r) => r.slotId === slot.id);

    // A blocked slot is drawn where it was, still buried. That is the honest
    // picture: nothing happened to it, and the bucket is why.
    const at = move ? move.to : { start: slot.start, end: slot.end };

    // How badly this position is buried, which is the whole question behind a
    // partial overlap and impossible to judge by eye at any sane zoom.
    const overlap = busy.reduce(
      (ms, b) =>
        ms + Math.max(0, Math.min(at.end, b.end) - Math.max(at.start, b.start)),
      0,
    );

    blocks.push({
      key: `slot:${slot.id}`,
      start: at.start,
      end: at.end,
      name: activity?.name ?? slot.activityId,
      isSlot: true,
      timeLabel: range(built, at.start, at.end),
      variant: suggested
        ? "suggested"
        : slot.status === "live" || slot.status === "started"
          ? "live"
          : activity?.kind === "focus"
            ? "focus"
            : "recovery",
      meta: [
        slot.id,
        range(built, at.start, at.end),
        mins(at.end - at.start),
        slot.status !== "planned" ? slot.status : null,
        overlap > 0
          ? overlap >= at.end - at.start
            ? "BURIED"
            : `OVERLAP ${mins(overlap)}`
          : null,
        move ? `was ${clockOf(slot.start, built.timeZone)}` : null,
        move ? `drift ${mins(move.driftMs)}` : null,
        move && move.breatherShortfallMs > 0
          ? `${mins(move.breatherShortfallMs)} short of breathing room`
          : null,
        blocked ? `NO ROOM · ${blocked.reason}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      ...(suggested ? { badge: move?.reasons.join(", ") } : {}),
    });
  }

  return blocks.sort((a, b) => a.start - b.start || a.end - b.end);
}

const gridItems = (blocks: readonly Block[]): DayGridItem[] =>
  blocks.map((block) => ({
    key: block.key,
    startsAt: block.start,
    endsAt: block.end,
    node: (
      <Slot
        variant={block.variant}
        time=""
        name={block.name}
        // Just the range here. The block is one column wide and the full line
        // truncates to uselessness in it - the ledger beside it has the room.
        meta={block.timeLabel}
        {...(block.badge ? { badge: block.badge } : {})}
      />
    ),
  }));

/* ── The ledger ──────────────────────────────────────────────────────────── */

interface GapRow {
  ms: number;
  /** What the breather rule asks for here, or 0 when neither side is ours. */
  wanted: number;
}

/**
 * What the breather rule asks of the space between two blocks.
 *
 * Read off the rule rather than restated: a session wants
 * `breatherFor(neighbour)` on each side, so a gap is judged by whichever of
 * its two sides is one of ours. Two meetings back to back is not our business
 * and gets no verdict.
 */
function wantedBetween(rule: BreatherRule, a: Block, b: Block): number {
  let wanted = 0;
  if (b.isSlot) wanted = Math.max(wanted, breatherFor(rule, a.end - a.start));
  if (a.isSlot) wanted = Math.max(wanted, breatherFor(rule, b.end - b.start));
  return wanted;
}

/**
 * The day as a list, with the gaps written down.
 *
 * The grid answers "where is everything"; this answers "how much room is
 * between them", which is the question the breather and overlap rules are
 * actually about and the one a timeline at any readable zoom cannot answer.
 */
const Ledger: React.FC<{ built: BuiltScenario; blocks: readonly Block[] }> = ({
  built,
  blocks,
}) => {
  const rows: React.ReactNode[] = [];

  blocks.forEach((block, i) => {
    const previous = blocks[i - 1];
    if (previous) {
      const gap: GapRow = {
        ms: block.start - previous.end,
        wanted: wantedBetween(built.breather, previous, block),
      };
      const ok = gap.ms >= gap.wanted;
      rows.push(
        <div
          className={`sim-gap${gap.wanted && !ok ? " sim-gap-short" : ""}`}
          key={`gap:${block.key}`}
        >
          {gap.ms < 0
            ? `▲ overlapping by ${mins(-gap.ms)}`
            : `↕ ${mins(gap.ms)}`}
          {gap.wanted > 0
            ? ` · wants ${mins(gap.wanted)} ${ok ? "✓" : "✗"}`
            : ""}
        </div>,
      );
    }
    rows.push(
      <div
        className={`sim-row sim-row-${block.isSlot ? "slot" : "meeting"}`}
        key={block.key}
      >
        <b>{clockOf(block.start, built.timeZone)}</b>
        <span>{block.name}</span>
        <em>{block.meta}</em>
      </div>,
    );
  });

  return <div className="sim-ledger">{rows}</div>;
};

/** One line per outcome, and the string a verdict is filed against. */
function summarise(built: BuiltScenario): string[] {
  const { result } = built;
  const lines: string[] = [];
  const where = (r: Relocation) =>
    `${clockOf(r.from.start, built.timeZone)} → ${range(built, r.to.start, r.to.end)}`;

  for (const r of result.moved) lines.push(`MOVED ${r.slotId} ${where(r)}`);
  for (const r of result.suggested) {
    lines.push(`SUGGESTED ${r.slotId} ${where(r)} (${r.reasons.join(", ")})`);
  }
  for (const b of result.blocked) {
    lines.push(`BLOCKED ${b.slotId} (${b.reason})`);
  }
  for (const id of result.frozenConflicts) {
    lines.push(`CLASHES, NOT MOVED ${id}`);
  }
  return lines.length ? lines : ["nothing to do"];
}

/* ── The page ────────────────────────────────────────────────────────────── */

function Sim() {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>("before");
  const [verdicts, setVerdicts] = useState<Verdicts>({});
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const scenario = SCENARIOS[index];
  const built = scenario ? runScenario(scenario) : undefined;
  const blocks = built ? blocksAt(built, step) : [];
  const outcome = built ? summarise(built).join("\n") : "";
  const current = scenario ? verdicts[scenario.id] : undefined;

  useEffect(() => {
    fetch(STORE)
      .then((r) => r.json())
      .then((data) => setVerdicts(data.verdicts ?? {}))
      .catch(() =>
        setSaved("verdict store unreachable - run under `vite dev`"),
      );
  }, []);

  // The comment box follows the scenario, not the keystrokes: switching
  // scenarios with a half-typed note left in the box files it against the
  // wrong one.
  useEffect(() => {
    setComment(scenario ? (verdicts[scenario.id]?.comment ?? "") : "");
    setStep("before");
  }, [scenario, verdicts]);

  const go = useCallback(
    (delta: number) =>
      setIndex((i) => (i + delta + SCENARIOS.length) % SCENARIOS.length),
    [],
  );

  /**
   * `advance` is what separates the two ways a verdict gets written.
   *
   * Pressing one of the three calls is a decision, and the next thing you want
   * is the next scenario - fifty-three of these is a sitting, and a click to
   * move on between each is a click too many. Blurring the comment box is not:
   * it fires when you tab away or reach for the mouse, and jumping the page
   * there would file the note and lose your place at the same time.
   */
  const save = useCallback(
    (call: Call, advance = false) => {
      if (!scenario) return;
      const verdict: Verdict = {
        call,
        comment,
        outcome,
        at: new Date().toISOString(),
      };
      setVerdicts((v) => ({ ...v, [scenario.id]: verdict }));
      // Named rather than read off the current scenario, which has moved on by
      // the time this resolves.
      const id = scenario.id;
      fetch(STORE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, verdict }),
      })
        .then(() => setSaved(`saved ${id}`))
        .catch(() => setSaved(`save failed for ${id}`));
      if (advance) go(1);
    },
    [scenario, comment, outcome, go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
      if (e.key === " ") {
        e.preventDefault();
        setStep((s) =>
          s === "before" ? "synced" : s === "synced" ? "rearranged" : "before",
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!scenario || !built) return <p>No scenarios.</p>;

  // Only verdicts for scenarios that still exist. Counting the file's keys
  // meant a renamed or deleted scenario left a ghost in the tally, and "53 of
  // 57" that included four ids nobody can open is worse than no count at all.
  const judged = SCENARIOS.filter((s) => verdicts[s.id]).length;
  const stale = current !== undefined && current.outcome !== outcome;

  return (
    <div className="sim">
      <style>{SIM_CSS}</style>

      <header className="sim-bar">
        <button type="button" onClick={() => go(-1)}>
          ←
        </button>
        <span className="sim-count">
          {index + 1} / {SCENARIOS.length}
        </span>
        <button type="button" onClick={() => go(1)}>
          →
        </button>
        <strong>{scenario.title}</strong>
        <code>{scenario.id}</code>
        {scenario.tags.map((tag) => (
          <span className="sim-tag" key={tag}>
            {tag}
          </span>
        ))}
        <span className="sim-spacer" />
        <span className="sim-count">
          {judged} / {SCENARIOS.length} judged
        </span>
        {saved ? <span className="sim-count">{saved}</span> : null}
      </header>

      <p className="sim-probes">{scenario.probes}</p>

      <nav className="sim-steps">
        {(["before", "synced", "rearranged"] as const).map((s) => (
          <button
            type="button"
            key={s}
            aria-pressed={step === s}
            onClick={() => setStep(s)}
          >
            {s === "before"
              ? "1 · The day"
              : s === "synced"
                ? "2 · Simulate the sync"
                : "3 · Rearrange"}
          </button>
        ))}
        <span className="sim-hint">← → scenario · space step</span>
      </nav>

      <div className="sim-body">
        <div className="sim-day">
          <DayGrid
            dayStart={built.dayStart}
            dayEnd={built.dayEnd}
            timeZone={built.timeZone}
            now={built.now}
            quarterStep={26}
            minBlockHeight={26}
            items={gridItems(blocks)}
          />
        </div>

        <div className="sim-ledger-col">
          <h3>The day, and the room between things</h3>
          <Ledger built={built} blocks={blocks} />
        </div>

        <aside className="sim-side">
          <h3>What changed</h3>
          <ul>
            {scenario.changes.map((change) => (
              <li key={JSON.stringify(change)}>
                <code>{JSON.stringify(change)}</code>
              </li>
            ))}
          </ul>

          <h3>What the engine did</h3>
          <pre className="sim-outcome">{outcome}</pre>

          <h3>The gap rule</h3>
          <p className="sim-note">
            {built.breather.minutes === 0 &&
            built.breather.longMinutes === 0 ? (
              <>
                <b>Off</b> for this scenario. A session takes the first minute
                it can. An activity&rsquo;s own buffer still applies.
              </>
            ) : (
              <>
                A session wants <b>{built.breather.minutes}m</b> clear of
                whatever it sits next to, or{" "}
                <b>{built.breather.longMinutes}m</b> when that neighbour runs{" "}
                {built.breather.longNeighbourMinutes}m or more. Preferred, not
                required — a missing minute costs {built.breather.weight}{" "}
                minutes of drift.
              </>
            )}{" "}
            Two sessions of one activity must be 30 minutes apart, and that one
            is a rule.
            {scenario.breather ? (
              <em className="sim-override"> · overridden by this scenario</em>
            ) : null}
          </p>

          <h3>Rules in play</h3>
          <ul>
            {scenario.activities.map((a) => (
              <li key={a.id}>
                <code>{a.id}</code> · {a.sessionMinutes}m
                {a.windows?.length
                  ? ` · window ${a.windows.map((w) => w.join("–")).join(", ")}`
                  : " · anywhere"}
                {a.spread ? " · spread" : ""}
                {a.bufferBeforeMeetingMinutes
                  ? ` · buffer ${a.bufferBeforeMeetingMinutes}m`
                  : ""}
              </li>
            ))}
          </ul>

          <h3>Verdict</h3>
          {stale ? (
            <p className="sim-stale">
              The engine has changed since this was judged. Old outcome:
              <br />
              <code>{current?.outcome}</code>
            </p>
          ) : null}
          <div className="sim-calls">
            {(["ok", "wrong", "unsure"] as const).map((call) => (
              <button
                type="button"
                key={call}
                aria-pressed={current?.call === call}
                onClick={() => save(call, true)}
              >
                {call === "ok"
                  ? "Right"
                  : call === "wrong"
                    ? "Wrong"
                    : "Not sure"}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            placeholder="What should happen instead?"
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => current && save(current.call)}
          />
        </aside>
      </div>
    </div>
  );
}

/* Scoped to this page and inlined with it, so deleting the file deletes the
   styles too. Nothing here belongs in the design system. */
const SIM_CSS = `
.sim { padding: 12px 16px 40px; font-size: 13px; }
.sim-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sim-bar button { border: 1px solid #ccc; border-radius: 6px; padding: 2px 9px; background: #fff; }
.sim-spacer { flex: 1; }
.sim-count { color: #777; font-variant-numeric: tabular-nums; }
.sim-tag { background: #eee; border-radius: 999px; padding: 1px 8px; color: #555; }
.sim-probes { margin: 8px 0; max-width: 70ch; color: #444; }
.sim-steps { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
.sim-steps button { border: 1px solid #ccc; border-radius: 6px; padding: 4px 10px; background: #fff; }
.sim-steps button[aria-pressed="true"] { background: #222; color: #fff; border-color: #222; }
.sim-hint { color: #999; margin-left: 8px; }
.sim-body { display: grid; grid-template-columns: 300px minmax(360px, 1fr) 340px; gap: 18px; align-items: start; }
.sim-ledger-col h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 0 0 8px; }
.sim-day { max-height: 78vh; overflow: auto; border: 1px solid #eee; border-radius: 10px; padding: 8px; }
.sim-ledger { font-size: 11.5px; border: 1px solid #eee; border-radius: 10px; padding: 10px 12px; }
.sim-row { display: grid; grid-template-columns: 52px 108px 1fr; gap: 8px; padding: 3px 0; align-items: baseline; }
.sim-row b { font-variant-numeric: tabular-nums; }
.sim-row em { font-style: normal; color: #777; }
.sim-row-meeting { color: #8a6d3b; }
.sim-row-slot b { color: #222; }
.sim-gap { padding: 1px 0 1px 52px; color: #aaa; font-variant-numeric: tabular-nums; }
.sim-gap-short { color: #b4433a; }
.sim-note { color: #666; margin: 0 0 6px; }
.sim-override { color: #b4433a; font-style: normal; }
.sim-side h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #888; margin: 14px 0 6px; }
.sim-side ul { margin: 0; padding-left: 16px; }
.sim-side li { margin-bottom: 3px; }
.sim-side code { font-size: 11px; }
.sim-outcome { background: #f6f6f6; border-radius: 8px; padding: 8px; white-space: pre-wrap; font-size: 11.5px; margin: 0; }
.sim-calls { display: flex; gap: 6px; margin-bottom: 8px; }
.sim-calls button { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 6px; background: #fff; }
.sim-calls button[aria-pressed="true"] { background: #222; color: #fff; border-color: #222; }
.sim-stale { background: #fff4d6; border-radius: 8px; padding: 8px; }
.sim-side textarea { width: 100%; min-height: 90px; border: 1px solid #ccc; border-radius: 8px; padding: 8px; font: inherit; }
`;
