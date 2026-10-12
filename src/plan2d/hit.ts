import { pointInPolygon, polygonArea } from '../geometry/polygon';
import { type Vec2, dist, projectOnSegment } from '../geometry/vec';
import type { Column, EntityType, Room, Selection, Wall } from '../model/types';

export type Hit =
  | { type: 'handle'; wallId: string; end: 'start' | 'end' }
  | { type: Exclude<EntityType, 'opening'>; id: string };

export interface HitScene {
  walls: Wall[];
  rooms: Room[];
  columns: Column[];
  selection: Selection;
  /** Pixel → meter conversion (1 / view scale). */
  px: number;
}

const HANDLE_PX = 10;
const WALL_PAD_PX = 5;

export function hitTest(p: Vec2, s: HitScene): Hit | null {
  if (s.selection.type === 'wall') {
    for (const id of s.selection.ids) {
      const w = s.walls.find((w) => w.id === id);
      if (!w) continue;
      if (dist(p, w.start) <= HANDLE_PX * s.px) return { type: 'handle', wallId: id, end: 'start' };
      if (dist(p, w.end) <= HANDLE_PX * s.px) return { type: 'handle', wallId: id, end: 'end' };
    }
  }
  for (const c of s.columns) {
    const hw = c.size.w / 2 + 2 * s.px;
    const hd = c.size.d / 2 + 2 * s.px;
    if (Math.abs(p.x - c.position.x) <= hw && Math.abs(p.y - c.position.y) <= hd)
      return { type: 'column', id: c.id };
  }
  let bestWall: { id: string; d: number } | null = null;
  for (const w of s.walls) {
    const d = projectOnSegment(p, w.start, w.end).distance;
    if (d <= Math.max(w.thickness / 2, WALL_PAD_PX * s.px) && (!bestWall || d < bestWall.d))
      bestWall = { id: w.id, d };
  }
  if (bestWall) return { type: 'wall', id: bestWall.id };
  const rooms = s.rooms
    .filter((r) => pointInPolygon(p, r.polygon))
    .sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  if (rooms[0]) return { type: 'room', id: rooms[0].id };
  return null;
}

/** Items inside a world-space rectangle. Walls win over rooms, rooms over columns. */
export function boxSelect(
  min: Vec2,
  max: Vec2,
  s: Pick<HitScene, 'walls' | 'rooms' | 'columns'>,
): Selection {
  const inside = (q: Vec2) => q.x >= min.x && q.x <= max.x && q.y >= min.y && q.y <= max.y;
  const walls = s.walls.filter(
    (w) =>
      inside(w.start) ||
      inside(w.end) ||
      inside({ x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 }),
  );
  if (walls.length) return { type: 'wall', ids: walls.map((w) => w.id) };
  const rooms = s.rooms.filter((r) => {
    const c = r.polygon.reduce(
      (a, q) => ({ x: a.x + q.x / r.polygon.length, y: a.y + q.y / r.polygon.length }),
      { x: 0, y: 0 },
    );
    return inside(c);
  });
  if (rooms.length) return { type: 'room', ids: rooms.map((r) => r.id) };
  const cols = s.columns.filter((c) => inside(c.position));
  if (cols.length) return { type: 'column', ids: cols.map((c) => c.id) };
  return { type: null, ids: [] };
}
