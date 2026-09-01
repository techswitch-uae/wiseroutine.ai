/**
 * Where a drop lands, for something not yet on the day.
 *
 * Beside the module that drags rather than inside it, for the same reason as
 * `lib/slot-state`: it is a rule, so it can be stated and tested without
 * mounting anything - and a file that exports a component and a function loses
 * fast refresh for the component.
 */

import { type DayScale, dropAt } from "@wiseroutine/design";

/**
 * The instant a session of `minutes` would start, dropped at this point.
 *
 * The grid's own arithmetic, borrowed rather than restated: `dropAt` snaps to
 * the ruler and clamps to the day, so a row dragged onto the last half hour
 * lands inside it rather than hanging off the end. Null when the cursor is not
 * over the day at all, which is what makes releasing there a cancel.
 */
export function dropTimeOf(
  point: { x: number; y: number },
  grid: DOMRect | null,
  scale: DayScale,
  dayEnd: number,
  minutes: number,
): number | null {
  if (!grid) return null;
  const inside =
    point.x >= grid.left &&
    point.x <= grid.right &&
    point.y >= grid.top &&
    point.y <= grid.bottom;
  if (!inside) return null;

  return dropAt(
    point.y - grid.top,
    { key: "", startsAt: 0, endsAt: minutes * 60_000 },
    scale,
    dayEnd,
  ).startsAt;
}
