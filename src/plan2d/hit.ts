import { pointInPolygon, polygonArea } from '../geometry/polygon';
import { type Vec2, dist, projectOnSegment } from '../geometry/vec';
import type { Column, EntityType, Room, Selection, Wall } from '../model/types';

export type Hit =
  | { type: 'handle'; wallId: string; end: 'start' | 'end' }
  | { type: 'rotate'; itemId: string }
  | { type: EntityType; id: string };

/** An item reduced to what hit-testing needs. */
export interface ItemBox {
  id: string;
  position: Vec2;
  rotation: number;
  w: number;
  d: number;
}

/** A door/window reduced to what hit-testing needs. */
export interface OpeningBox {
  id: string;
  center: Vec2;
  /** Wall direction (radians). */
  angle: number;
  width: number;
  thickness: number;
}

export interface HitScene {
  walls: Wall[];
  rooms: Room[];
  columns: Column[];
  items?: ItemBox[];
  openings?: OpeningBox[];
  /** Stairs visible on this level (their plan polygons). */
  stairs?: { id: string; polys: Vec2[][] }[];
  selection: Selection;
  /** Pixel → meter conversion (1 / view scale). */
  px: number;
}

const HANDLE_PX = 10;
const WALL_PAD_PX = 5;

/** Where the rotate handle of a selected item sits: in front of it, beyond its edge. */
export function rotateHandlePos(it: ItemBox, px: number): Vec2 {
  const reach = it.d / 2 + 22 * px;
  return {
    x: it.position.x - Math.sin(it.rotation) * reach,
    y: it.position.y + Math.cos(it.rotation) * reach,
  };
}

export function hitTest(p: Vec2, s: HitScene): Hit | null {
  if (s.selection.type === 'wall') {
    for (const id of s.selection.ids) {
      const w = s.walls.find((w) => w.id === id);
      if (!w) continue;
      if (dist(p, w.start) <= HANDLE_PX * s.px) return { type: 'handle', wallId: id, end: 'start' };
      if (dist(p, w.end) <= HANDLE_PX * s.px) return { type: 'handle', wallId: id, end: 'end' };
    }
  }
  if (s.selection.type === 'item' && s.selection.ids.length === 1) {
    const it = s.items?.find((i) => i.id === s.selection.ids[0]);
    if (it) {
      const h = rotateHandlePos(it, s.px);
      if (dist(p, h) <= HANDLE_PX * s.px) return { type: 'rotate', itemId: it.id };
    }
  }
  const inItem = (s.items ?? [])
    .filter((it) => {
      const lx =
        Math.cos(-it.rotation) * (p.x - it.position.x) -
        Math.sin(-it.rotation) * (p.y - it.position.y);
      const ly =
        Math.sin(-it.rotation) * (p.x - it.position.x) +
        Math.cos(-it.rotation) * (p.y - it.position.y);
      return Math.abs(lx) <= it.w / 2 + 2 * s.px && Math.abs(ly) <= it.d / 2 + 2 * s.px;
    })
    .sort((a, b) => a.w * a.d - b.w * b.d);
  if (inItem[0]) return { type: 'item', id: inItem[0].id };
  for (const o of s.openings ?? []) {
    const dx = p.x - o.center.x;
    const dy = p.y - o.center.y;
    const u = dx * Math.cos(o.angle) + dy * Math.sin(o.angle);
    const v = -dx * Math.sin(o.angle) + dy * Math.cos(o.angle);
    if (Math.abs(u) <= o.width / 2 && Math.abs(v) <= o.thickness / 2 + 3 * s.px)
      return { type: 'opening', id: o.id };
  }
  for (const st of s.stairs ?? [])
    if (st.polys.some((poly) => pointInPolygon(p, poly))) return { type: 'stair', id: st.id };
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
