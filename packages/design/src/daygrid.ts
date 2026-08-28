/**
 * Where every block on a day goes, as arithmetic.
 *
 * Pure on purpose, and separate from the component on purpose. This is the
 * part that has to be right: a drag reads it on every pointer move to decide
 * where the drop would land, so a rounding error here is a slot placed at the
 * wrong time, and a browser is a poor place to find that out. Everything below
 * is numbers in, numbers out - no DOM, no clock, no React.
 *
 * The surface is one uniform scale. Minutes and pixels convert with a single
 * multiplication in both directions, which is what lets a drag follow a cursor
 * exactly rather than by measuring elements and hoping they have not moved.
 */

export interface DayBlock {
  key: string;
  startsAt: number;
  endsAt: number;
}

export interface PlacedBlock<T extends DayBlock = DayBlock> {
  block: T;
  /** Pixels from the top of the surface. */
  top: number;
  height: number;
  /** Zero-based column, how many it spans, and how many the cluster has. */
  column: number;
  span: number;
  columns: number;
}

export interface DayScale {
  /** Epoch ms at the top of the surface. */
  dayStart: number;
  pxPerMinute: number;
  /**
   * The shortest a block may be drawn.
   *
   * A five-minute block is four pixels tall at any scale a day fits on a
   * screen, which is not a thing anyone can read or grab. Below this the block
   * stops being proportional and stays legible instead; above it, height is
   * duration and nothing else. Trading proportionality for legibility only at
   * the bottom end is the whole compromise.
   */
  minHeight: number;
}

const MINUTE = 60_000;

/** Snap grain. Two minutes of rounding is invisible; a block drawn between the
 *  lines is not. */
export const SNAP_MINUTES = 5;

export const yOf = (at: number, scale: DayScale): number =>
  ((at - scale.dayStart) / MINUTE) * scale.pxPerMinute;

export const atOf = (y: number, scale: DayScale): number =>
  scale.dayStart + (y / scale.pxPerMinute) * MINUTE;

/** The nearest instant a block may start on. */
export const snap = (at: number): number =>
  Math.round(at / (SNAP_MINUTES * MINUTE)) * (SNAP_MINUTES * MINUTE);

const heightOf = (block: DayBlock, scale: DayScale): number =>
  Math.max(
    scale.minHeight,
    ((block.endsAt - block.startsAt) / MINUTE) * scale.pxPerMinute,
  );

/**
 * Lay the day out.
 *
 * Overlap is decided on the *drawn* rectangles, not on the times. Two
 * five-minute blocks six minutes apart do not overlap in the day and very much
 * do on the screen, and a layout that consulted the times would draw them on
 * top of each other - which is the one thing columns exist to prevent.
 *
 * Within a cluster of overlapping blocks, columns are ordered by how long each
 * block is, shortest first. Not by start time, which is the obvious choice and
 * the wrong one here: a block being dragged changes its start continuously, so
 * ordering by it would slide the preview between columns as the cursor moves.
 * Length does not change while dragging, so the preview lands in one column
 * and stays in it - which is what makes the drop predictable.
 */
export function layoutDay<T extends DayBlock>(
  blocks: readonly T[],
  scale: DayScale,
): PlacedBlock<T>[] {
  const boxes = blocks.map((block) => ({
    block,
    top: yOf(block.startsAt, scale),
    height: heightOf(block, scale),
    minutes: (block.endsAt - block.startsAt) / MINUTE,
    column: 0,
    span: 1,
    columns: 1,
  }));

  // Clustering needs them in vertical order; the answer does not. See the note
  // on the return below for why that distinction matters.
  const byTop = [...boxes].sort(
    (a, b) => a.top - b.top || cmp(a.block.key, b.block.key),
  );

  // Clusters: everything transitively overlapping something else. Column counts
  // are per cluster, so one clash at ten in the morning cannot narrow a block
  // at four in the afternoon.
  let cluster: typeof boxes = [];
  let clusterBottom = Number.NEGATIVE_INFINITY;

  const close = () => {
    if (cluster.length === 0) return;

    // Shortest first, then by key. Deliberately *not* by position after that:
    // two blocks of the same length have nothing to tell them apart but where
    // they are, and where they are is the one thing a drag changes - so they
    // would trade columns the instant one crossed the other. Key is arbitrary
    // and, far more usefully, constant.
    const ordered = [...cluster].sort(
      (a, b) => a.minutes - b.minutes || cmp(a.block.key, b.block.key),
    );

    const columnBottoms: number[] = [];
    for (const box of ordered) {
      let column = columnBottoms.findIndex((bottom) => bottom <= box.top);
      if (column === -1) column = columnBottoms.length;
      columnBottoms[column] = box.top + box.height;
      box.column = column;
    }

    const columns = Math.max(1, columnBottoms.length);
    for (const box of cluster) {
      box.columns = columns;
      // Then widen into whatever is free to the right. Without this, one clash
      // halves every block in the cluster, which reads as a column layout the
      // day does not have.
      while (
        box.column + box.span < columns &&
        !cluster.some(
          (other) =>
            other !== box &&
            other.column === box.column + box.span &&
            overlaps(other, box),
        )
      ) {
        box.span += 1;
      }
    }

    cluster = [];
    clusterBottom = Number.NEGATIVE_INFINITY;
  };

  for (const box of byTop) {
    if (box.top >= clusterBottom) close();
    cluster.push(box);
    clusterBottom = Math.max(clusterBottom, box.top + box.height);
  }
  close();

  // In the order they arrived, never in the order they are drawn.
  //
  // Blocks are positioned absolutely, so the order of this array decides
  // nothing about what anyone sees - and it decided something much worse.
  // Sorting by position meant a dragged block changed places in the list the
  // moment it crossed another one, React reordered the DOM to match, and moving
  // an element in the DOM releases its pointer capture. The drag froze at the
  // crossing every time, and only for blocks whose order could change - which
  // is why it looked like a bug about two identical slots.
  return boxes.map(({ block, top, height, column, span, columns }) => ({
    block,
    top,
    height,
    column,
    span,
    columns,
  }));
}

const overlaps = (
  a: { top: number; height: number },
  b: { top: number; height: number },
): boolean => a.top < b.top + b.height && b.top < a.top + a.height;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where a block would land if dropped with its top at `y`.
 *
 * Clamped so a block can never be dragged off either end of the day, and
 * snapped so it always lands on the ruler. The duration is carried through
 * untouched: dragging moves a block, it does not resize one.
 */
export function dropAt(
  y: number,
  block: DayBlock,
  scale: DayScale,
  dayEnd: number,
): { startsAt: number; endsAt: number } {
  const length = block.endsAt - block.startsAt;
  const startsAt = Math.min(
    Math.max(snap(atOf(y, scale)), scale.dayStart),
    dayEnd - length,
  );
  return { startsAt, endsAt: startsAt + length };
}

/**
 * How far to scroll this frame, with the pointer here.
 *
 * A drag has to do this itself. The browser auto-scrolls for its own native
 * drags and for a text selection being swept, and this is deliberately
 * neither - so without this the block simply stops at the edge of the screen
 * with more day underneath it.
 *
 * Zero anywhere comfortably inside the edges, then linear: gentle where the
 * zone begins and quickest right on the edge. Linear because a curve here is a
 * thing to tune rather than a thing to understand.
 */
export function edgeScroll(
  pointerY: number,
  bounds: { top: number; bottom: number },
  zone = EDGE_ZONE,
  max = MAX_SCROLL_SPEED,
): number {
  const speed = (depth: number) =>
    Math.ceil((Math.min(depth, zone) / zone) * max);

  const above = pointerY - bounds.top;
  const below = bounds.bottom - pointerY;
  // Past the edge entirely - the pointer left the container - counts as being
  // right on it rather than as being nowhere, or a drag dragged clean off the
  // window would stop scrolling exactly when it most needs to.
  if (above < zone) return -speed(zone - above);
  if (below < zone) return speed(zone - below);
  return 0;
}

/** How close to an edge the pointer has to be before the day starts scrolling
 *  itself, and how fast it goes when the pointer is right on it. */
export const EDGE_ZONE = 64;
export const MAX_SCROLL_SPEED = 22;
