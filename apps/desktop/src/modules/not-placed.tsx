import {
  Button,
  type DayScale,
  StateRow,
  scaleFor,
  Widget,
} from "@wiseroutine/design";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type BucketItem } from "../lib/api";
import { refreshCaptured } from "../lib/capture";
import { useDensity } from "../lib/density";
import { dropTimeOf } from "../lib/drop-time";
import { type NotPlacedRow, notPlacedRows } from "../lib/not-placed";
import { notify } from "../lib/notify";
import { type Placement, setPlacing, usePlacing } from "../lib/placing";
import { reloadPlan, usePlan, useTodayPlan } from "../lib/plan-store";

const STEP = 5 * 60_000;

/** One passive list for both saved unplaced slots and the day's fresh demand.
 * A failed placement leaves the same slots here. Nothing needs dismissing. */
export function NotPlaced({
  standalone = false,
  query = "",
}: {
  standalone?: boolean;
  query?: string;
}) {
  const viewedPlan = usePlan();
  const todayPlan = useTodayPlan();
  const plan = standalone ? todayPlan : viewedPlan;
  const density = useDensity();
  const [saved, setSaved] = useState<BucketItem[]>([]);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const dayKey = JSON.stringify([standalone, plan?.date, plan?.timeZone]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [revision, setRevision] = useState(0);
  const drag = usePlacing();
  const held = useRef<Placement | null>(null);
  held.current = drag;
  const latest = useRef({ scale: null as DayScale | null, dayEnd: 0 });
  latest.current = {
    scale: plan ? scaleFor(density, plan.dayStart) : null,
    dayEnd: plan?.dayEnd ?? 0,
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly retries the read after an error or mutation
  useEffect(() => {
    if (!plan && !standalone) return;
    let active = true;
    let sequence = 0;
    const refresh = () => {
      const order = ++sequence;
      setLoading(true);
      void api
        .bucket(
          !standalone && plan ? (plan.dayStart + plan.dayEnd) / 2 : undefined,
        )
        .then((rows) => {
          if (active && order === sequence) {
            setSaved(standalone ? rows.filter((row) => !row.reminderId) : rows);
            setSavedFor(dayKey);
            setError(false);
          }
        })
        .catch(() => {
          if (active && order === sequence) setError(true);
        })
        .finally(() => {
          if (active && order === sequence) setLoading(false);
        });
    };
    refresh();
    globalThis.addEventListener("wr:inbox-changed", refresh);
    return () => {
      active = false;
      globalThis.removeEventListener("wr:inbox-changed", refresh);
    };
  }, [plan, standalone, revision, dayKey]);

  const settle = () => {
    working.current = false;
    setBusy(false);
    refreshCaptured();
    reloadPlan();
    setRevision((value) => value + 1);
  };
  const place = (at: Placement) => {
    if (working.current || plan?.stale || at.startsAt === null) return;
    if (at.startsAt < Date.now()) {
      notify("Choose a time ahead of now.");
      return;
    }
    working.current = true;
    setBusy(true);
    const end = at.startsAt + at.minutes * 60_000;
    void (
      at.slotId
        ? api.moveSlot(at.slotId, at.startsAt, end)
        : api.placeSlot(at.activityId, at.startsAt, end)
    )
      .catch((cause: unknown) =>
        notify(
          cause instanceof ApiError && cause.detail
            ? cause.detail
            : "Couldn't place that slot there. Check for space and try again.",
        ),
      )
      .finally(settle);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  const dragging = drag !== null && !standalone;
  useEffect(() => {
    if (!dragging) return;
    const point = (event: PointerEvent) => {
      const current = held.current;
      if (!current || current.keyboard) return;
      const { scale, dayEnd } = latest.current;
      const grid =
        document.querySelector(".wr-daygrid")?.getBoundingClientRect() ?? null;
      setPlacing({
        ...current,
        x: event.clientX,
        y: event.clientY,
        startsAt: scale
          ? dropTimeOf(
              { x: event.clientX, y: event.clientY },
              grid,
              scale,
              dayEnd,
              current.minutes,
              Date.now(),
            )
          : null,
      });
    };
    const cancel = () => {
      held.current = null;
      setPlacing(null);
    };
    const commit = () => {
      const current = held.current;
      cancel();
      if (current?.startsAt != null) placeRef.current(current);
    };
    const drop = () => {
      if (!held.current?.keyboard) commit();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      const current = held.current;
      if (!current?.keyboard) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        commit();
        return;
      }
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const { scale, dayEnd } = latest.current;
      const earliest =
        Math.ceil(Math.max(Date.now(), scale?.dayStart ?? 0) / STEP) * STEP;
      const last =
        Math.floor((dayEnd - current.minutes * 60_000) / STEP) * STEP;
      if (last < earliest) return;
      setPlacing({
        ...current,
        startsAt: Math.min(
          last,
          Math.max(
            earliest,
            (current.startsAt ?? earliest) +
              (event.key === "ArrowUp" ? -STEP : STEP),
          ),
        ),
      });
    };
    globalThis.addEventListener("pointermove", point);
    globalThis.addEventListener("pointerup", drop);
    globalThis.addEventListener("pointercancel", cancel);
    globalThis.addEventListener("keydown", key);
    return () => {
      globalThis.removeEventListener("pointermove", point);
      globalThis.removeEventListener("pointerup", drop);
      globalThis.removeEventListener("pointercancel", cancel);
      globalThis.removeEventListener("keydown", key);
    };
  }, [dragging]);

  const rows = notPlacedRows(
    standalone ? [] : (plan?.progress ?? []),
    savedFor === dayKey ? saved : [],
  ).filter((row) =>
    row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  if (!plan && !standalone) return null;
  if (!loading && !error && rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  // Not `loading`: every sync re-reads the list, and disabling the rows for
  // each of those flashed the grips and the button on every window focus. Rows
  // this day already has stay usable while it refreshes; the server still
  // refuses a placement that went stale in between.
  const disabled = busy || error || plan?.stale === true || savedFor !== dayKey;
  const begin = (row: NotPlacedRow, x: number, y: number, keyboard = false) => {
    if (disabled || !plan) return;
    const start = Math.ceil(Math.max(Date.now(), plan.dayStart) / STEP) * STEP;
    if (keyboard && start + row.minutes * 60_000 > plan.dayEnd) {
      notify("No space left on this day. The slot stays in Not placed.");
      return;
    }
    setPlacing({
      activityId: row.activityId,
      slotId: row.slotId,
      name: row.name,
      kind: row.kind,
      minutes: row.minutes,
      startsAt: keyboard ? start : null,
      x,
      y,
      keyboard,
    });
  };
  const fill = () => {
    if (!plan || disabled || working.current) return;
    if (Date.now() >= plan.dayEnd) {
      notify("No space left on this day. Your slots are still in Not placed.");
      return;
    }
    working.current = true;
    setBusy(true);
    void api
      .plan("user_request", Math.round((plan.dayStart + plan.dayEnd) / 2))
      .then(({ placed, unplaced }) => {
        // Another tab may already have placed slots since this count was read.
        const remaining = unplaced.reduce(
          (sum, slot) => sum + slot.sessions,
          0,
        );
        if (remaining > 0)
          notify(
            unplaced.some((slot) => slot.reason === "not_scheduled_today")
              ? "Some slots aren't available to place. They're still in Not placed."
              : placed > 0
                ? `Placed ${placed}. No space for ${remaining} more; they're still in Not placed.`
                : "No space on this day. Your slots are still in Not placed.",
          );
      })
      .catch(() =>
        notify("Couldn't place your slots just now. They're still here."),
      )
      .finally(settle);
  };

  return (
    <Widget eyebrow="Not placed" count={total || undefined}>
      {error ? (
        <p role="alert">
          Couldn't load your unplaced slots.{" "}
          <Button
            variant="quiet"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </Button>
        </p>
      ) : null}
      {loading && !rows.length ? (
        <p className="wr-body">Loading slots…</p>
      ) : null}
      {rows.map((row) => (
        <div key={row.key} style={{ marginTop: 8 }}>
          <StateRow
            recessed
            name={row.name}
            meta={`${row.minutes} min${row.count > 1 ? ` · ${row.count} slots` : ""}`}
            leading={
              standalone ? null : (
                <button
                  type="button"
                  className="wr-grip wr-placement-grip"
                  disabled={disabled}
                  aria-label={`Place ${row.name}. Drag, or press Enter then use arrow keys and Enter to place. Escape cancels.`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.focus();
                    begin(row, event.clientX, event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      !held.current
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      begin(row, 0, 0, true);
                    }
                  }}
                >
                  ⋮⋮
                </button>
              )
            }
            trailing={null}
          />
        </div>
      ))}
      {standalone ? (
        <a href="/">Open Today to place slots</a>
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <Button
              variant="commit"
              onClick={fill}
              disabled={disabled || total === 0}
            >
              {busy ? "Finding space…" : "Place them for me"}
            </Button>
          </div>
          <p
            className="wr-body"
            style={{
              margin: "10px 0 0",
              font: "400 12.5px/1.45 var(--font-body)",
            }}
          >
            Drag a slot onto your day, or leave it here.
          </p>
          {drag?.keyboard && drag.startsAt !== null ? (
            <p role="status" className="wr-body">
              {drag.name} at{" "}
              {new Intl.DateTimeFormat(undefined, {
                timeZone: plan?.timeZone,
                hour: "numeric",
                minute: "2-digit",
              }).format(drag.startsAt)}
              . Arrow keys move; Enter places; Escape cancels.
            </p>
          ) : null}
        </>
      )}
    </Widget>
  );
}
