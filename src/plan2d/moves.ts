import { type Vec2, add, dist, projectOnSegment } from '../geometry/vec';
import type { Room, Wall } from '../model/types';
import type { WallGeometry } from '../model/ops/plan';

const SAME = 1e-3;

type Geo = Pick<Wall, 'id' | 'start' | 'end'>;

/**
 * Translating selected walls by `delta`. Unselected walls that share an endpoint with a moved wall have
 * that endpoint follow, so corners stay connected. Returns only walls that changed.
 */
export function computeWallMove(walls: Geo[], selectedIds: string[], delta: Vec2): WallGeometry[] {
  const sel = new Set(selectedIds);
  const movedFrom: Vec2[] = [];
  for (const w of walls) if (sel.has(w.id)) movedFrom.push(w.start, w.end);
  const follows = (pt: Vec2) => movedFrom.some((q) => dist(q, pt) < SAME);
  const out: WallGeometry[] = [];
  for (const w of walls) {
    if (sel.has(w.id)) out.push({ id: w.id, start: add(w.start, delta), end: add(w.end, delta) });
    else if (follows(w.start) || follows(w.end)) {
      out.push({
        id: w.id,
        start: follows(w.start) ? add(w.start, delta) : w.start,
        end: follows(w.end) ? add(w.end, delta) : w.end,
      });
    }
  }
  return out;
}

/** Moves one wall endpoint to `to`; every other wall endpoint at the same spot follows. */
export function computeEndpointMove(
  walls: Geo[],
  wallId: string,
  end: 'start' | 'end',
  to: Vec2,
): WallGeometry[] {
  const target = walls.find((w) => w.id === wallId);
  if (!target) return [];
  const from = target[end];
  const out: WallGeometry[] = [];
  for (const w of walls) {
    const s = dist(w.start, from) < SAME;
    const e = dist(w.end, from) < SAME;
    if (w.id === wallId)
      out.push({
        id: w.id,
        start: end === 'start' ? to : w.start,
        end: end === 'end' ? to : w.end,
      });
    else if (s || e) out.push({ id: w.id, start: s ? to : w.start, end: e ? to : w.end });
  }
  return out;
}

/** Walls whose centerline lies on the outline of `room` (used to move a room as a unit). */
export function wallsOnRoomOutline(walls: Wall[], room: Room): string[] {
  const poly = room.polygon;
  const onOutline = (pt: Vec2) =>
    poly.some((a, i) => projectOnSegment(pt, a, poly[(i + 1) % poly.length]!).distance < SAME);
  return walls
    .filter((w) => w.levelId === room.levelId)
    .filter(
      (w) =>
        onOutline(w.start) &&
        onOutline(w.end) &&
        onOutline({ x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 }),
    )
    .map((w) => w.id);
}
