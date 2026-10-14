import type { Box, Candidate } from './assemble';

/**
 * Geometry clean-up in code, never by the model: the boxes the model drew are in picture pixels and a little crooked;
 * this turns them into rectangles in feet whose walls line up. Steps: scale → snap near-equal edges together → close
 * small gaps between neighbours → remove overlaps → (optionally) fit every room to the size printed on its label.
 */
export interface PlanRect {
  id: string;
  name: string;
  kind: 'room' | 'zone';
  type: string;
  /** [x, y, width, depth] in feet. */
  rect: [number, number, number, number];
  labelSize?: [number, number];
  confidence: number;
  source: Candidate['source'];
  /** Where the model drew it, in feet (before any fitting). */
  pictured: [number, number, number, number];
}

export interface CleanupOptions {
  /** Feet per picture pixel. */
  ftPerPx: number;
  /** Edges closer than this are one wall (feet). */
  snap?: number;
  /** Neighbours with a gap up to this are pulled together (feet). */
  closeGap?: number;
  /** 'labelled': every room gets exactly its printed size. 'pictured': as drawn. */
  fit: 'labelled' | 'pictured';
  /** Grid to round to (feet). */
  grid?: number;
}

export interface CleanupResult {
  rects: PlanRect[];
  /** What was changed or dropped that the user should know. */
  notes: string[];
}

const r4 = (v: number, grid: number) => Math.round(v / grid) * grid;

type R = [number, number, number, number]; // x0, y0, x1, y1

const overlapLen = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) - Math.max(a0, b0);

/** Edge values that lie within `tol` of each other (complete linkage) become their rounded mean. */
function clusterEdges(values: number[], tol: number, grid: number): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  let group: number[] = [];
  const flush = () => {
    if (!group.length) return;
    const mean = r4(group.reduce((s, v) => s + v, 0) / group.length, grid);
    for (const g of group) map.set(g, mean);
    group = [];
  };
  for (const v of sorted) {
    if (group.length && v - group[0]! > tol) flush();
    group.push(v);
  }
  flush();
  return map;
}

export function cleanup(candidates: Candidate[], opts: CleanupOptions): CleanupResult {
  const grid = opts.grid ?? 0.25;
  const tol = opts.snap ?? 1.0;
  const gapMax = opts.closeGap ?? 2.0;
  const notes: string[] = [];
  const f = opts.ftPerPx;

  let items = candidates
    .filter((c) => c.box[2] - c.box[0] > 0 && c.box[3] - c.box[1] > 0)
    .map((c) => {
      const pictured = c.box.map((v) => v * f) as R;
      return { c, r: [...pictured] as R, pictured: pictured as R };
    });

  // 1. one wall where several edges are within the tolerance
  const xs = clusterEdges(
    items.flatMap((i) => [i.r[0], i.r[2]]),
    tol,
    grid,
  );
  const ys = clusterEdges(
    items.flatMap((i) => [i.r[1], i.r[3]]),
    tol,
    grid,
  );
  for (const i of items) i.r = [xs.get(i.r[0])!, ys.get(i.r[1])!, xs.get(i.r[2])!, ys.get(i.r[3])!];
  items = items.filter((i) => {
    const ok = i.r[2] - i.r[0] >= 2 * grid && i.r[3] - i.r[1] >= 2 * grid;
    if (!ok)
      notes.push(`"${i.c.name}" collapsed to nothing when its walls were aligned and was left out`);
    return ok;
  });

  // 2. pull neighbours together across small gaps (rooms and zones among themselves)
  for (let pass = 0; pass < 3; pass++)
    for (const a of items)
      for (const b of items) {
        if (a === b) continue;
        // a is left of b
        const gx = b.r[0] - a.r[2];
        if (
          gx > 0 &&
          gx <= gapMax &&
          overlapLen(a.r[1], a.r[3], b.r[1], b.r[3]) >=
            0.4 * Math.min(a.r[3] - a.r[1], b.r[3] - b.r[1])
        ) {
          const m = r4((a.r[2] + b.r[0]) / 2, grid);
          a.r[2] = m;
          b.r[0] = m;
        }
        // a is above b
        const gy = b.r[1] - a.r[3];
        if (
          gy > 0 &&
          gy <= gapMax &&
          overlapLen(a.r[0], a.r[2], b.r[0], b.r[2]) >=
            0.4 * Math.min(a.r[2] - a.r[0], b.r[2] - b.r[0])
        ) {
          const m = r4((a.r[3] + b.r[1]) / 2, grid);
          a.r[3] = m;
          b.r[1] = m;
        }
      }

  // 3. overlaps: cut along the thinner overlap, at its middle. Rooms outrank zones (a zone gives way).
  const resolve = (
    movable: (x: (typeof items)[number], y: (typeof items)[number]) => 'a' | 'b' | 'both',
  ) => {
    for (let pass = 0; pass < 30; pass++) {
      let changed = false;
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i]!;
          const b = items[j]!;
          const px = overlapLen(a.r[0], a.r[2], b.r[0], b.r[2]);
          const py = overlapLen(a.r[1], a.r[3], b.r[1], b.r[3]);
          if (px <= 0.05 || py <= 0.05) continue;
          const who = movable(a, b);
          const alongX = px <= py;
          const [lo, hi] = alongX
            ? a.r[0] + a.r[2] <= b.r[0] + b.r[2]
              ? [a, b]
              : [b, a]
            : a.r[1] + a.r[3] <= b.r[1] + b.r[3]
              ? [a, b]
              : [b, a];
          const k = alongX ? 0 : 1;
          const mid = r4(
            (Math.max(lo.r[k]!, hi.r[k]!) + Math.min(lo.r[k + 2]!, hi.r[k + 2]!)) / 2,
            grid,
          );
          const cutLo = who === 'both' || who === (lo === a ? 'a' : 'b');
          const cutHi = who === 'both' || who === (hi === a ? 'a' : 'b');
          if (cutLo) lo.r[k + 2] = cutHi ? mid : hi.r[k]!;
          if (cutHi) hi.r[k] = cutLo ? mid : lo.r[k + 2]!;
          changed = true;
        }
      if (!changed) break;
    }
  };
  resolve((a, b) => (a.c.kind === b.c.kind ? 'both' : a.c.kind === 'zone' ? 'a' : 'b'));
  items = items.filter((i) => {
    const ok =
      i.r[2] - i.r[0] >= 3 && i.r[3] - i.r[1] >= 3
        ? true
        : i.c.kind === 'room'
          ? i.r[2] - i.r[0] >= 2 && i.r[3] - i.r[1] >= 2
          : i.r[2] - i.r[0] >= 1 && i.r[3] - i.r[1] >= 1;
    if (!ok) notes.push(`"${i.c.name}" was squeezed out by its neighbours and was left out`);
    return ok;
  });

  // 4. fit every room (not zones) to the size on its label
  if (opts.fit === 'labelled') {
    for (const i of items) {
      const want = i.c.labelSize;
      if (!want) continue;
      const w = i.r[2] - i.r[0];
      const d = i.r[3] - i.r[1];
      // the label's orientation is the one nearest to the drawn shape
      const straight = Math.abs(w - want[0]) + Math.abs(d - want[1]);
      const turned = Math.abs(w - want[1]) + Math.abs(d - want[0]);
      const [nw, nd] = straight <= turned ? want : [want[1], want[0]];
      const cx = (i.r[0] + i.r[2]) / 2;
      const cy = (i.r[1] + i.r[3]) / 2;
      i.r = [r4(cx - nw / 2, grid), r4(cy - nd / 2, grid), 0, 0];
      i.r[2] = i.r[0] + nw;
      i.r[3] = i.r[1] + nd;
    }
    // the exact sizes may collide: push the less sure one away, along the thinner overlap
    for (let pass = 0; pass < 40; pass++) {
      let changed = false;
      for (let a = 0; a < items.length; a++)
        for (let b = a + 1; b < items.length; b++) {
          const A = items[a]!;
          const B = items[b]!;
          if (A.c.kind === 'zone' || B.c.kind === 'zone') continue; // zones are trimmed below
          const px = overlapLen(A.r[0], A.r[2], B.r[0], B.r[2]);
          const py = overlapLen(A.r[1], A.r[3], B.r[1], B.r[3]);
          if (px <= 0.05 || py <= 0.05) continue;
          const mover = A.c.confidence <= B.c.confidence ? A : B;
          const stay = mover === A ? B : A;
          if (px <= py) {
            const dir = mover.r[0] + mover.r[2] <= stay.r[0] + stay.r[2] ? -1 : 1;
            const dx = dir * (px + 0.0);
            mover.r = [mover.r[0] + dx, mover.r[1], mover.r[2] + dx, mover.r[3]];
          } else {
            const dir = mover.r[1] + mover.r[3] <= stay.r[1] + stay.r[3] ? -1 : 1;
            const dy = dir * py;
            mover.r = [mover.r[0], mover.r[1] + dy, mover.r[2], mover.r[3] + dy];
          }
          changed = true;
        }
      if (!changed) break;
    }
    // exact sizes leave gaps: slide the less sure room of each facing pair against its neighbour, if nothing is in the way
    const rooms = () => items.filter((i) => i.c.kind === 'room');
    const blocked = (m: (typeof items)[number], r: R) =>
      rooms().some(
        (o) =>
          o !== m &&
          overlapLen(r[0], r[2], o.r[0], o.r[2]) > 0.05 &&
          overlapLen(r[1], r[3], o.r[1], o.r[3]) > 0.05,
      );
    for (let pass = 0; pass < 30; pass++) {
      let moved = false;
      for (const a of rooms())
        for (const b of rooms()) {
          if (a === b) continue;
          const mover = a.c.confidence <= b.c.confidence ? a : b;
          const stay = mover === a ? b : a;
          // stay is left of mover, with a gap
          const gx = mover.r[0] - stay.r[2];
          if (
            gx > 0.05 &&
            gx <= 8 &&
            overlapLen(a.r[1], a.r[3], b.r[1], b.r[3]) >=
              0.3 * Math.min(a.r[3] - a.r[1], b.r[3] - b.r[1])
          ) {
            const next: R = [mover.r[0] - gx, mover.r[1], mover.r[2] - gx, mover.r[3]];
            if (!blocked(mover, next)) {
              mover.r = next;
              moved = true;
            }
          }
          const gy = mover.r[1] - stay.r[3];
          if (
            gy > 0.05 &&
            gy <= 8 &&
            overlapLen(a.r[0], a.r[2], b.r[0], b.r[2]) >=
              0.3 * Math.min(a.r[2] - a.r[0], b.r[2] - b.r[0])
          ) {
            const next: R = [mover.r[0], mover.r[1] - gy, mover.r[2], mover.r[3] - gy];
            if (!blocked(mover, next)) {
              mover.r = next;
              moved = true;
            }
          }
        }
      if (!moved) break;
    }
    // zones give way to rooms, never the other way round
    resolve((a, b) =>
      a.c.kind === 'zone' && b.c.kind === 'room'
        ? 'a'
        : b.c.kind === 'zone' && a.c.kind === 'room'
          ? 'b'
          : 'both',
    );
    // zones with a printed size are fitted too, now that the rooms are final (keeping what the cut left)
  }

  const rects: PlanRect[] = items.map((i) => {
    const x = r4(i.r[0], grid);
    const y = r4(i.r[1], grid);
    return {
      id: i.c.id,
      name: i.c.name,
      kind: i.c.kind,
      type: i.c.type,
      rect: [
        x,
        y,
        Math.max(grid, r4(i.r[2] - i.r[0], grid)),
        Math.max(grid, r4(i.r[3] - i.r[1], grid)),
      ],
      ...(i.c.labelSize ? { labelSize: i.c.labelSize } : {}),
      confidence: i.c.confidence,
      source: i.c.source,
      pictured: [
        i.pictured[0],
        i.pictured[1],
        i.pictured[2] - i.pictured[0],
        i.pictured[3] - i.pictured[1],
      ],
    };
  });
  return { rects, notes };
}

/** Feet per pixel when the user did not say: the median over labelled boxes of sqrt(printed area ÷ drawn area). */
export function guessFtPerPx(candidates: Candidate[]): number | null {
  const ratios = candidates
    .filter((c) => c.labelSize && c.source === 'label+box')
    .map((c) => {
      const px = (c.box[2] - c.box[0]) * (c.box[3] - c.box[1]);
      return px > 0 ? Math.sqrt((c.labelSize![0] * c.labelSize![1]) / px) : NaN;
    })
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)]! : null;
}

export type { Box };
