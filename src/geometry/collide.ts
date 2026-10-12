import { type Vec2, add, rotate } from './vec';

/** Corners of a w × d box centered at `c`, rotated by `rotation` (plan: local x → (cos, sin), local y → (−sin, cos)). */
export function boxCorners(c: Vec2, w: number, d: number, rotation: number): Vec2[] {
  return [
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 },
  ].map((p) => add(c, rotate(p, rotation)));
}

/** Rectangle covering a wall's centerline segment with its thickness. */
export function wallRect(start: Vec2, end: Vec2, thickness: number): Vec2[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

/**
 * Separating-axis test for two convex polygons. Returns the smallest overlap depth (m) along any axis,
 * or 0 when they are apart or merely touching.
 */
export function overlapDepth(a: Vec2[], b: Vec2[]): number {
  let min = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const ax = -(q.y - p.y);
      const ay = q.x - p.x;
      const len = Math.hypot(ax, ay);
      if (len < 1e-12) continue;
      const proj = (pts: Vec2[]) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of pts) {
          const d = (v.x * ax + v.y * ay) / len;
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
        return [lo, hi] as const;
      };
      const [al, ah] = proj(a);
      const [bl, bh] = proj(b);
      const overlap = Math.min(ah, bh) - Math.max(al, bl);
      if (overlap <= 0) return 0;
      min = Math.min(min, overlap);
    }
  }
  return Number.isFinite(min) ? min : 0;
}
