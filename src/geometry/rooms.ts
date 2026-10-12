import { polygonArea, pointInPolygon, polygonBounds } from './polygon';
import { type Vec2, cross, dist, sub } from './vec';

export interface Segment {
  start: Vec2;
  end: Vec2;
}

const EPS = 1e-4;
/** Faces smaller than this (m²) are ignored as slivers. */
export const MIN_ROOM_AREA = 0.25;

/** Parameters t∈[0,1] along `a` where it meets segment `b` (crossings, touches, collinear overlap ends). */
function splitParams(a: Segment, b: Segment): number[] {
  const r = sub(a.end, a.start);
  const s = sub(b.end, b.start);
  const rLen = Math.hypot(r.x, r.y);
  if (rLen < EPS) return [];
  const denom = cross(r, s);
  const qp = sub(b.start, a.start);
  const out: number[] = [];
  if (Math.abs(denom) < 1e-9 * rLen * Math.hypot(s.x, s.y)) {
    // Parallel: only collinear overlap matters — b's endpoints lying on a.
    if (Math.abs(cross(qp, r)) / rLen > EPS) return [];
    for (const p of [b.start, b.end]) {
      const t = ((p.x - a.start.x) * r.x + (p.y - a.start.y) * r.y) / (rLen * rLen);
      if (t > 0 && t < 1) out.push(t);
    }
    return out;
  }
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  const tol = EPS / rLen;
  const uTol = EPS / Math.max(Math.hypot(s.x, s.y), EPS);
  if (t > -tol && t < 1 + tol && u > -uTol && u < 1 + uTol) out.push(Math.min(1, Math.max(0, t)));
  return out;
}

class NodeIndex {
  pts: Vec2[] = [];
  id(p: Vec2): number {
    const i = this.pts.findIndex((q) => dist(p, q) < EPS);
    if (i >= 0) return i;
    this.pts.push({ x: p.x, y: p.y });
    return this.pts.length - 1;
  }
}

/** Removes spikes (dead-end walls traversed twice) and collinear vertices. */
function cleanRing(ring: Vec2[]): Vec2[] {
  const pts = ring.slice();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]!;
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      const spike = dist(prev, next) < EPS;
      const a = sub(cur, prev);
      const b = sub(next, cur);
      const collinear =
        Math.abs(cross(a, b)) < 1e-7 * (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) + 1e-12);
      if (spike || collinear || dist(prev, cur) < EPS) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Finds every minimal closed region formed by wall centerlines.
 * Segments are split where they cross or touch, then faces of the planar graph are traced.
 * Returns counter-clockwise polygons (in a y-up sense; area is positive).
 */
export function detectRoomPolygons(segments: Segment[]): Vec2[][] {
  const idx = new NodeIndex();
  const edgeKeys = new Set<string>();
  const edges: [number, number][] = [];

  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    const ts = [0, 1];
    for (let j = 0; j < segments.length; j++) {
      if (i !== j) ts.push(...splitParams(a, segments[j]!));
    }
    ts.sort((x, y) => x - y);
    const pts = ts.map((t) => ({
      x: a.start.x + (a.end.x - a.start.x) * t,
      y: a.start.y + (a.end.y - a.start.y) * t,
    }));
    for (let k = 0; k + 1 < pts.length; k++) {
      const u = idx.id(pts[k]!);
      const v = idx.id(pts[k + 1]!);
      if (u === v) continue;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push([u, v]);
    }
  }

  const adj = new Map<number, number[]>();
  for (const [u, v] of edges) {
    (adj.get(u) ?? adj.set(u, []).get(u)!).push(v);
    (adj.get(v) ?? adj.set(v, []).get(v)!).push(u);
  }
  const angle = (u: number, v: number) => {
    const a = idx.pts[u]!;
    const b = idx.pts[v]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  for (const [u, list] of adj) list.sort((a, b) => angle(u, a) - angle(u, b));

  const visited = new Set<string>();
  const faces: Vec2[][] = [];
  for (const [u0, list] of adj) {
    for (const v0 of list) {
      if (visited.has(`${u0}>${v0}`)) continue;
      const ring: number[] = [];
      let u = u0;
      let v = v0;
      let guard = 0;
      while (!visited.has(`${u}>${v}`) && guard++ < 10000) {
        visited.add(`${u}>${v}`);
        ring.push(u);
        const out = adj.get(v)!;
        const back = out.indexOf(u);
        const next = out[(back - 1 + out.length) % out.length]!;
        u = v;
        v = next;
      }
      const poly = cleanRing(ring.map((i) => idx.pts[i]!));
      if (poly.length < 3) continue;
      // Interior faces trace counter-clockwise in this walk (positive signed area); the outer face is negative.
      let signed = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        signed += p.x * q.y - q.x * p.y;
      }
      if (signed / 2 > MIN_ROOM_AREA) faces.push(poly);
    }
  }
  return faces;
}

/** Fraction of overlap (intersection / union) between two polygons, estimated on a sampling grid. */
export function polygonIoU(a: Vec2[], b: Vec2[], samples = 40): number {
  const ba = polygonBounds(a);
  const bb = polygonBounds(b);
  const min = { x: Math.min(ba.min.x, bb.min.x), y: Math.min(ba.min.y, bb.min.y) };
  const max = { x: Math.max(ba.max.x, bb.max.x), y: Math.max(ba.max.y, bb.max.y) };
  let inter = 0;
  let union = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const p = {
        x: min.x + ((i + 0.5) / samples) * (max.x - min.x),
        y: min.y + ((j + 0.5) / samples) * (max.y - min.y),
      };
      const inA = pointInPolygon(p, a);
      const inB = pointInPolygon(p, b);
      if (inA && inB) inter++;
      if (inA || inB) union++;
    }
  }
  return union === 0 ? 0 : inter / union;
}

export interface RoomMatch {
  /** detected polygon index → existing room id */
  matches: Map<number, string>;
  unmatchedDetected: number[];
  unmatchedExisting: string[];
}

/** Pairs newly detected polygons with existing rooms by overlap so names/types survive shape changes. */
export function matchRooms(
  existing: { id: string; polygon: Vec2[] }[],
  detected: Vec2[][],
  threshold = 0.3,
): RoomMatch {
  const pairs: { d: number; id: string; score: number }[] = [];
  // Rooms far apart cannot overlap: compare bounding boxes first (the sampling below is the expensive part).
  const boxes = existing.map((e) => polygonBounds(e.polygon));
  const touches = (a: ReturnType<typeof polygonBounds>, b: ReturnType<typeof polygonBounds>) =>
    a.min.x < b.max.x - EPS &&
    b.min.x < a.max.x - EPS &&
    a.min.y < b.max.y - EPS &&
    b.min.y < a.max.y - EPS;
  detected.forEach((poly, d) => {
    const box = polygonBounds(poly);
    for (let k = 0; k < existing.length; k++) {
      const e = existing[k]!;
      if (!touches(box, boxes[k]!)) continue;
      const score = samePolygon(poly, e.polygon) ? 1 : polygonIoU(poly, e.polygon);
      if (score >= threshold) pairs.push({ d, id: e.id, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const matches = new Map<number, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (matches.has(p.d) || used.has(p.id)) continue;
    matches.set(p.d, p.id);
    used.add(p.id);
  }
  return {
    matches,
    unmatchedDetected: detected.map((_, i) => i).filter((i) => !matches.has(i)),
    unmatchedExisting: existing.filter((e) => !used.has(e.id)).map((e) => e.id),
  };
}

/** True when both polygons have the same set of corners (ignoring start vertex and winding). */
export function samePolygon(a: Vec2[], b: Vec2[]): boolean {
  if (a.length !== b.length) return false;
  return (
    a.every((p) => b.some((q) => dist(p, q) < 1e-3)) &&
    Math.abs(polygonArea(a) - polygonArea(b)) < 1e-3
  );
}
