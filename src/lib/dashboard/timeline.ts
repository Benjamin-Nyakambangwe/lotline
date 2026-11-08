/**
 * Layout for the "Tonight" timeline: lots placed on a time axis by when they close, stacked
 * into lanes so near-simultaneous closes (ABC closes lots ~20 s apart) don't overlap.
 * Pure, so it's tested at phone width.
 */
export interface TimelineLot {
  id: number;
  /** when it closes now (ms) */
  end: number;
  /** when it was due to close before soft-close extensions (ms), if different */
  originalEnd: number | null;
}

export interface Placed {
  id: number;
  x: number;
  /** where the extension trail starts, for extended lots */
  xOriginal: number | null;
  lane: number;
}

export interface TimelineLayout {
  start: number;
  end: number;
  x: (t: number) => number;
  placed: Placed[];
  lanes: number;
  ticks: { t: number; x: number }[];
}

const MIN = 60_000;
const STEPS_MIN = [5, 10, 15, 30, 60, 120, 240];

export function layoutTimeline(
  lots: TimelineLot[],
  opts: {
    width: number;
    now: number;
    inset?: number;
    mark?: number;
    maxLanes?: number;
  },
): TimelineLayout {
  const inset = opts.inset ?? 14;
  const mark = opts.mark ?? 12;
  const maxLanes = opts.maxLanes ?? 8;
  const times = lots.flatMap((l) =>
    l.originalEnd ? [l.end, l.originalEnd] : [l.end],
  );
  let start = Math.min(...times) - 5 * MIN;
  let end = Math.max(...times) + 5 * MIN;
  // Include "now" when it's close enough to matter (the run-up to the first close).
  if (opts.now >= start - 90 * MIN && opts.now <= end + 30 * MIN) {
    start = Math.min(start, opts.now - 5 * MIN);
    end = Math.max(end, opts.now + 5 * MIN);
  }
  if (end - start < 30 * MIN) {
    const mid = (start + end) / 2;
    start = mid - 15 * MIN;
    end = mid + 15 * MIN;
  }
  const plot = Math.max(1, opts.width - inset * 2);
  const x = (t: number) => inset + ((t - start) / (end - start)) * plot;

  // Lanes: first one whose last mark (or trail) ends far enough left.
  const lastX: number[] = [];
  const placed: Placed[] = [...lots]
    .sort((a, b) => a.end - b.end || a.id - b.id)
    .map((l) => {
      const px = x(l.end);
      const xOriginal =
        l.originalEnd && l.originalEnd < l.end ? x(l.originalEnd) : null;
      const from = xOriginal ?? px;
      let lane = lastX.findIndex((lx) => lx + mark + 3 <= from - mark / 2);
      if (lane < 0) {
        if (lastX.length < maxLanes)
          lane = lastX.push(Number.NEGATIVE_INFINITY) - 1;
        else lane = lastX.indexOf(Math.min(...lastX));
      }
      lastX[lane] = px;
      return { id: l.id, x: px, xOriginal, lane };
    });

  // Ticks on round clock times, at least ~64 px apart.
  const step =
    (STEPS_MIN.find((s) => (s * MIN * plot) / (end - start) >= 64) ?? 240) *
    MIN;
  const ticks: { t: number; x: number }[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step)
    ticks.push({ t, x: x(t) });

  return { start, end, x, placed, lanes: Math.max(1, lastX.length), ticks };
}
