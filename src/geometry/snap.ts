import { type Vec2, add, dist, lerp, projectOnSegment, scale, sub } from './vec';

export type SnapKind =
  'none' | 'grid' | 'endpoint' | 'midpoint' | 'angle' | 'parallel' | 'perpendicular';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
}

export interface SnapContext {
  enabled: boolean;
  gridSize: number;
  /** Pixel tolerance converted to meters by the caller (tolerancePx / viewScale). */
  tolerance: number;
  /** Wall centerlines and shell edges to snap against. */
  segments: { start: Vec2; end: Vec2 }[];
  /** Extra endpoint-only targets (e.g. shell corners). */
  points?: Vec2[];
  /** Previous point of the chain being drawn — enables angle / parallel / perpendicular snapping. */
  anchor?: Vec2;
}

const ANGLE_TOLERANCE = (4 * Math.PI) / 180;

export const snapToGrid = (p: Vec2, g: number): Vec2 => ({
  x: Math.round(p.x / g) * g,
  y: Math.round(p.y / g) * g,
});

const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** Finds the best snap target for `raw`. Priority: endpoints → midpoints → angle guides → grid. */
export function snap(raw: Vec2, ctx: SnapContext): SnapResult {
  if (!ctx.enabled) return { point: raw, kind: 'none' };

  let best: SnapResult | null = null;
  let bestDist = ctx.tolerance;
  const consider = (p: Vec2, kind: SnapKind) => {
    const d = dist(raw, p);
    if (d < bestDist - 1e-12) {
      bestDist = d;
      best = { point: p, kind };
    }
  };
  for (const p of ctx.points ?? []) consider(p, 'endpoint');
  for (const s of ctx.segments) {
    consider(s.start, 'endpoint');
    consider(s.end, 'endpoint');
  }
  if (best) return best;
  for (const s of ctx.segments) consider(lerp(s.start, s.end, 0.5), 'midpoint');
  if (best) return best;

  if (ctx.anchor) {
    const v = sub(raw, ctx.anchor);
    const len = Math.hypot(v.x, v.y);
    if (len > 1e-6) {
      const cur = Math.atan2(v.y, v.x);
      const candidates: { angle: number; kind: SnapKind }[] = [];
      for (let k = 0; k < 8; k++) candidates.push({ angle: (k * Math.PI) / 4, kind: 'angle' });
      for (const s of ctx.segments) {
        const a = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x);
        candidates.push({ angle: a, kind: 'parallel' }, { angle: a + Math.PI, kind: 'parallel' });
        candidates.push(
          { angle: a + Math.PI / 2, kind: 'perpendicular' },
          { angle: a - Math.PI / 2, kind: 'perpendicular' },
        );
      }
      let pick: { angle: number; kind: SnapKind; diff: number } | null = null;
      for (const c of candidates) {
        const diff = Math.abs(Math.atan2(Math.sin(cur - c.angle), Math.cos(cur - c.angle)));
        // Prefer the axis/45° guides when angles tie (they are listed first).
        if (diff < ANGLE_TOLERANCE && (!pick || diff < pick.diff - 1e-9)) pick = { ...c, diff };
      }
      if (pick) {
        const dir = { x: Math.cos(pick.angle), y: Math.sin(pick.angle) };
        // Along the guide, round the length to the grid for tidy dimensions.
        const along = Math.max(
          0,
          Math.round((len * Math.cos(pick.diff)) / ctx.gridSize) * ctx.gridSize,
        );
        const point = add(ctx.anchor, scale(dir, along));
        return { point: { x: clean(point.x), y: clean(point.y) }, kind: pick.kind };
      }
    }
  }
  const g = snapToGrid(raw, ctx.gridSize);
  return { point: { x: clean(g.x), y: clean(g.y) }, kind: 'grid' };
}

/** Nearest wall segment to `p` within `maxDist`, if any. */
export function nearestSegment<T extends { start: Vec2; end: Vec2 }>(
  p: Vec2,
  items: T[],
  maxDist: number,
): { item: T; distance: number; t: number } | null {
  let best: { item: T; distance: number; t: number } | null = null;
  for (const item of items) {
    const r = projectOnSegment(p, item.start, item.end);
    if (r.distance <= maxDist && (!best || r.distance < best.distance))
      best = { item, distance: r.distance, t: r.t };
  }
  return best;
}
