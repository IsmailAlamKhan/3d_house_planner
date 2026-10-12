export interface Vec2 {
  x: number;
  y: number;
}

export const EPS = 1e-9;

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Projects `p` onto segment a→b; returns the distance along the segment (clamped) and the point. */
export function projectOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { t: number; distance: number; point: Vec2 } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  const point = add(a, scale(ab, t));
  return { t, distance: dist(p, point), point };
}
