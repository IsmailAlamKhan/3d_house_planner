/**
 * Small pure helpers for plans written as rectangles and polygons in plain units (feet or metres): shared walls,
 * outside walls, point-in-polygon. Used by the villa author script and by "Recreate from picture".
 */
export type Pt = [number, number];
export type Rect = [number, number, number, number];
export type Shape = { rect?: Rect; polygon?: Pt[] };

export const rectPoly = (r: Rect): Pt[] => [
  [r[0], r[1]],
  [r[0] + r[2], r[1]],
  [r[0] + r[2], r[1] + r[3]],
  [r[0], r[1] + r[3]],
];
export const polyOf = (s: Shape): Pt[] => s.polygon ?? rectPoly(s.rect!);

/** Bounding box of a shape as [x, y, width, depth]. */
export const bbox = (s: Shape): Rect => {
  const p = polyOf(s);
  const xs = p.map((a) => a[0]);
  const ys = p.map((a) => a[1]);
  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  ];
};

export interface Stretch {
  p: Pt;
  q: Pt;
  len: number;
}

const edgesOf = (poly: Pt[]): [Pt, Pt][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]!]);

/** Longest stretch two polygons share along a straight edge (a wall between them), or null. */
export function sharedSegment(a: Pt[], b: Pt[], minLen = 0.5): Stretch | null {
  let best: Stretch | null = null;
  for (const [a1, a2] of edgesOf(a))
    for (const [b1, b2] of edgesOf(b)) {
      const dx = a2[0] - a1[0];
      const dy = a2[1] - a1[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const ux = dx / L;
      const uy = dy / L;
      const dist = (p: Pt) => Math.abs((p[0] - a1[0]) * uy - (p[1] - a1[1]) * ux);
      if (dist(b1) > 0.02 || dist(b2) > 0.02) continue;
      const t1 = (b1[0] - a1[0]) * ux + (b1[1] - a1[1]) * uy;
      const t2 = (b2[0] - a1[0]) * ux + (b2[1] - a1[1]) * uy;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(L, Math.max(t1, t2));
      if (hi - lo > (best?.len ?? minLen))
        best = {
          p: [a1[0] + ux * lo, a1[1] + uy * lo],
          q: [a1[0] + ux * hi, a1[1] + uy * hi],
          len: hi - lo,
        };
    }
  return best;
}

/** Stretches of a polygon's edges that no other polygon touches (the outside walls), at least `minLen` long. */
export function freeEdges(poly: Pt[], others: Pt[][], minLen: number): Stretch[] {
  const out: Stretch[] = [];
  for (const [a1, a2] of edgesOf(poly)) {
    const dx = a2[0] - a1[0];
    const dy = a2[1] - a1[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const ux = dx / L;
    const uy = dy / L;
    const covered: [number, number][] = [];
    for (const o of others)
      for (const [b1, b2] of edgesOf(o)) {
        const dist = (p: Pt) => Math.abs((p[0] - a1[0]) * uy - (p[1] - a1[1]) * ux);
        if (dist(b1) > 0.02 || dist(b2) > 0.02) continue;
        const t1 = (b1[0] - a1[0]) * ux + (b1[1] - a1[1]) * uy;
        const t2 = (b2[0] - a1[0]) * ux + (b2[1] - a1[1]) * uy;
        const lo = Math.max(0, Math.min(t1, t2));
        const hi = Math.min(L, Math.max(t1, t2));
        if (hi - lo > 0.05) covered.push([lo, hi]);
      }
    covered.sort((x, y) => x[0] - y[0]);
    let t = 0;
    const gaps: [number, number][] = [];
    for (const [lo, hi] of covered) {
      if (lo > t + 0.05) gaps.push([t, lo]);
      t = Math.max(t, hi);
    }
    if (t < L - 0.05) gaps.push([t, L]);
    for (const [lo, hi] of gaps)
      if (hi - lo >= minLen)
        out.push({
          p: [a1[0] + ux * lo, a1[1] + uy * lo],
          q: [a1[0] + ux * hi, a1[1] + uy * hi],
          len: hi - lo,
        });
  }
  return out;
}

export function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
