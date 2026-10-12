import { pointInPolygon } from '../../geometry/polygon';
import type { Point } from '../../model/types';
import type { Rect } from './plan';

export const EDGE_EPS = 1e-6;

/** Squarified treemap: lays out `weights` (in order) inside `rect`, filling it exactly. */
export function squarify(weights: number[], rect: Rect): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || total <= 0) return [];
  const areas = weights.map((w) => (w / total) * rect.w * rect.h);
  const out: Rect[] = new Array(weights.length);
  let free = { ...rect };
  let i = 0;

  const worst = (row: number[], side: number): number => {
    const s = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  while (i < areas.length) {
    const horizontal = free.w >= free.h; // lay the row along the shorter side
    const side = horizontal ? free.h : free.w;
    const row: number[] = [areas[i]!];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]!], side) <= worst(row, side)) {
      row.push(areas[j]!);
      j++;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    const thickness = sum / side;
    let offset = 0;
    row.forEach((a, k) => {
      const len = a / thickness;
      out[i + k] = horizontal
        ? { x: free.x, y: free.y + offset, w: thickness, h: len }
        : { x: free.x + offset, y: free.y, w: len, h: thickness };
      offset += len;
    });
    free = horizontal
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    i += row.length;
  }
  return out;
}

export interface SharedEdge {
  a: Point;
  b: Point;
  length: number;
  /** `x` = the edge runs along the x axis (a horizontal wall), `y` = along y (a vertical wall). */
  axis: 'x' | 'y';
}

/** The stretch of boundary two rectangles have in common (null if they only touch at a corner or not at all). */
export function sharedEdge(a: Rect, b: Rect): SharedEdge | null {
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-4;
  // Vertical shared wall (a's right = b's left, or the reverse)
  for (const [l, r] of [
    [a, b],
    [b, a],
  ] as const) {
    if (near(l.x + l.w, r.x)) {
      const y0 = Math.max(l.y, r.y);
      const y1 = Math.min(l.y + l.h, r.y + r.h);
      if (y1 - y0 > 1e-4)
        return { a: { x: r.x, y: y0 }, b: { x: r.x, y: y1 }, length: y1 - y0, axis: 'y' };
    }
    if (near(l.y + l.h, r.y)) {
      const x0 = Math.max(l.x, r.x);
      const x1 = Math.min(l.x + l.w, r.x + r.w);
      if (x1 - x0 > 1e-4)
        return { a: { x: x0, y: r.y }, b: { x: x1, y: r.y }, length: x1 - x0, axis: 'x' };
    }
  }
  return null;
}

/** Stretches of `r`'s boundary that lie on the shell rectangle's outline. */
export function exteriorEdges(r: Rect, shell: Rect): SharedEdge[] {
  const out: SharedEdge[] = [];
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-4;
  if (near(r.y, shell.y))
    out.push({ a: { x: r.x, y: r.y }, b: { x: r.x + r.w, y: r.y }, length: r.w, axis: 'x' });
  if (near(r.y + r.h, shell.y + shell.h))
    out.push({
      a: { x: r.x, y: r.y + r.h },
      b: { x: r.x + r.w, y: r.y + r.h },
      length: r.w,
      axis: 'x',
    });
  if (near(r.x, shell.x))
    out.push({ a: { x: r.x, y: r.y }, b: { x: r.x, y: r.y + r.h }, length: r.h, axis: 'y' });
  if (near(r.x + r.w, shell.x + shell.w))
    out.push({
      a: { x: r.x + r.w, y: r.y },
      b: { x: r.x + r.w, y: r.y + r.h },
      length: r.h,
      axis: 'y',
    });
  return out;
}

export const aspect = (r: Rect): number => Math.max(r.w, r.h) / Math.max(Math.min(r.w, r.h), 1e-6);

/** Largest axis-aligned rectangle inside a polygon whose corners come from the polygon's own coordinates. */
export function largestInnerRect(poly: Point[]): { rect: Rect; exact: boolean } {
  const xs = [...new Set(poly.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(poly.map((p) => p.y))].sort((a, b) => a - b);
  const inside = (r: Rect) => {
    const n = 6;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        if (!pointInPolygon({ x: r.x + (r.w * i) / n, y: r.y + (r.h * j) / n }, poly, 1e-6))
          return false;
      }
    }
    return true;
  };
  let best: Rect | null = null;
  for (let a = 0; a < xs.length; a++) {
    for (let b = a + 1; b < xs.length; b++) {
      for (let c = 0; c < ys.length; c++) {
        for (let d = c + 1; d < ys.length; d++) {
          const r = { x: xs[a]!, y: ys[c]!, w: xs[b]! - xs[a]!, h: ys[d]! - ys[c]! };
          if ((!best || r.w * r.h > best.w * best.h) && inside(r)) best = r;
        }
      }
    }
  }
  const rect = best ?? {
    x: xs[0]!,
    y: ys[0]!,
    w: xs[xs.length - 1]! - xs[0]!,
    h: ys[ys.length - 1]! - ys[0]!,
  };
  const polyArea =
    Math.abs(
      poly.reduce(
        (s, p, i) =>
          s + (p.x * poly[(i + 1) % poly.length]!.y - poly[(i + 1) % poly.length]!.x * p.y),
        0,
      ),
    ) / 2;
  return { rect, exact: Math.abs(polyArea - rect.w * rect.h) < 1e-3 };
}

/** Seeded PRNG (mulberry32) so layouts are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: T[], rnd: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
