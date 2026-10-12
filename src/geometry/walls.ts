import { type Vec2, add, cross, dist, scale, sub } from './vec';

export interface WallSeg {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
}

export interface JoinOptions {
  /** 'miter' (default) extends edges to meet at corners; 'butt' leaves square ends. */
  join?: 'miter' | 'butt';
  /** Miter points further than this × half-thickness from the node fall back to a butt join. */
  miterLimit?: number;
}

const NODE_EPS = 1e-4;

interface Entry {
  wallId: string;
  at: 'start' | 'end';
  dir: Vec2; // unit, pointing away from the node
  half: number;
  angle: number;
  left?: Vec2;
  right?: Vec2;
}

const leftNormal = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });

function intersectLines(p: Vec2, d1: Vec2, q: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(q, p), d2) / denom;
  return add(p, scale(d1, t));
}

/**
 * Builds the outline polygon of every wall, cleaning up the corners where walls meet.
 * Polygon order: [startLeft, endLeft, endRight, startRight] where "left" is the +90° side of start→end.
 * Shared by the 2D plan and the 3D scene so corners look the same in both.
 */
export function computeWallPolygons(walls: WallSeg[], opts: JoinOptions = {}): Map<string, Vec2[]> {
  const join = opts.join ?? 'miter';
  const miterLimit = opts.miterLimit ?? 4;

  const nodes: { pos: Vec2; entries: Entry[] }[] = [];
  const nodeAt = (p: Vec2) => {
    let n = nodes.find((n) => dist(n.pos, p) < NODE_EPS);
    if (!n) nodes.push((n = { pos: p, entries: [] }));
    return n;
  };

  for (const w of walls) {
    const len = dist(w.start, w.end);
    if (len < 1e-9) continue;
    const d = scale(sub(w.end, w.start), 1 / len);
    const half = w.thickness / 2;
    const s = { wallId: w.id, at: 'start' as const, dir: d, half };
    const e = { wallId: w.id, at: 'end' as const, dir: scale(d, -1), half };
    nodeAt(w.start).entries.push({ ...s, angle: Math.atan2(d.y, d.x) });
    nodeAt(w.end).entries.push({ ...e, angle: Math.atan2(-d.y, -d.x) });
  }

  for (const { pos, entries } of nodes) {
    entries.sort((a, b) => a.angle - b.angle);
    const butt = (i: number) => {
      const en = entries[i]!;
      const n = leftNormal(en.dir);
      en.left = add(pos, scale(n, en.half));
      en.right = sub(pos, scale(n, en.half));
    };
    if (entries.length === 1 || join === 'butt') {
      entries.forEach((_, i) => butt(i));
      continue;
    }
    const k = entries.length;
    for (let i = 0; i < k; i++) {
      const a = entries[i]!;
      const b = entries[(i + 1) % k]!;
      const la = add(pos, scale(leftNormal(a.dir), a.half));
      const rb = sub(pos, scale(leftNormal(b.dir), b.half));
      const c = intersectLines(la, a.dir, rb, b.dir);
      if (c && dist(c, pos) <= miterLimit * Math.max(a.half, b.half)) {
        a.left = c;
        b.right = c;
      } else {
        a.left = la;
        b.right = rb;
      }
    }
  }

  const byWall = new Map<string, { start?: Entry; end?: Entry }>();
  for (const { entries } of nodes) {
    for (const en of entries) {
      const rec = byWall.get(en.wallId) ?? {};
      rec[en.at] = en;
      byWall.set(en.wallId, rec);
    }
  }
  const out = new Map<string, Vec2[]>();
  for (const [id, { start, end }] of byWall) {
    if (!start?.left || !start.right || !end?.left || !end.right) continue;
    out.set(id, [start.left, end.right, end.left, start.right]);
  }
  return out;
}
