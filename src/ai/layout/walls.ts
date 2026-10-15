import type { PlannedWall, Rect } from './plan';

const q = (v: number) => Math.round(v * 1000) / 1000;

interface Interval {
  line: number;
  a: number;
  b: number;
}

function merge(intervals: Interval[]): Interval[] {
  const byLine = new Map<number, Interval[]>();
  for (const i of intervals) {
    const k = q(i.line);
    (byLine.get(k) ?? byLine.set(k, []).get(k)!).push({
      line: k,
      a: Math.min(i.a, i.b),
      b: Math.max(i.a, i.b),
    });
  }
  const out: Interval[] = [];
  for (const list of byLine.values()) {
    list.sort((x, y) => x.a - y.a);
    let cur = { ...list[0]! };
    for (const next of list.slice(1)) {
      if (next.a <= cur.b + 1e-4) cur.b = Math.max(cur.b, next.b);
      else {
        out.push(cur);
        cur = { ...next };
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Turns room rectangles into the minimal set of wall segments: shared edges become ONE wall and
 * collinear/overlapping edges are merged, so no wall is drawn twice. Walls on the shell outline are exterior.
 */
export function wallsFromRects(
  rects: Rect[],
  shell: Rect,
  level: number,
  /** Open-air rectangles (courts, voids): a wall on their boundary faces the outside. */
  outdoor: Rect[] = [],
): PlannedWall[] {
  const horizontals: Interval[] = [];
  const verticals: Interval[] = [];
  for (const r of rects) {
    horizontals.push(
      { line: r.y, a: r.x, b: r.x + r.w },
      { line: r.y + r.h, a: r.x, b: r.x + r.w },
    );
    verticals.push({ line: r.x, a: r.y, b: r.y + r.h }, { line: r.x + r.w, a: r.y, b: r.y + r.h });
  }
  const onShell = (line: number, lo: number, hi: number) =>
    Math.abs(line - lo) < 1e-3 || Math.abs(line - hi) < 1e-3;
  // A segment is exterior too when it runs along the edge of an open court.
  const onCourt = (axis: 'x' | 'y', line: number, a: number, b: number) =>
    outdoor.some((o) =>
      axis === 'x'
        ? (Math.abs(line - o.y) < 1e-3 || Math.abs(line - (o.y + o.h)) < 1e-3) &&
          Math.min(b, o.x + o.w) - Math.max(a, o.x) > 1e-3
        : (Math.abs(line - o.x) < 1e-3 || Math.abs(line - (o.x + o.w)) < 1e-3) &&
          Math.min(b, o.y + o.h) - Math.max(a, o.y) > 1e-3,
    );
  const walls: PlannedWall[] = [];
  for (const h of merge(horizontals)) {
    walls.push({
      level,
      start: { x: q(h.a), y: h.line },
      end: { x: q(h.b), y: h.line },
      type:
        onShell(h.line, shell.y, shell.y + shell.h) || onCourt('x', h.line, h.a, h.b)
          ? 'exterior'
          : 'interior',
    });
  }
  for (const v of merge(verticals)) {
    walls.push({
      level,
      start: { x: v.line, y: q(v.a) },
      end: { x: v.line, y: q(v.b) },
      type:
        onShell(v.line, shell.x, shell.x + shell.w) || onCourt('y', v.line, v.a, v.b)
          ? 'exterior'
          : 'interior',
    });
  }
  return walls;
}
