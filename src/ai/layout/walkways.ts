import { getEntry } from '../../catalog';
import { boxCorners, overlapDepth } from '../../geometry/collide';
import type { Point } from '../../model/types';
import type { PlannedItem, PlannedOpening, PlannedRoom } from './plan';

/** A path between two doors must stay at least this wide (m). */
export const WALKWAY_WIDTH = 0.9;

/** Things that can go without harm when they stand in a walkway (the rest is furniture the room is for). */
const DECOR = new Set([
  'plant',
  'plant-small',
  'plant-medium',
  'plant-large',
  'floor-lamp',
  'side-table',
  'coffee-table',
  'armchair',
  'dresser',
  'bookshelf',
  'vase',
  'bowl',
  'planter',
  'kitchen-island',
  'tv-unit',
]);

/** A blocking table is tried one size smaller before it is dropped. */
const SMALLER: Record<string, string> = {
  'dining-table-8': 'dining-table-6',
  'dining-table-6': 'dining-table-4',
  'bed-king': 'bed-queen',
  'bed-queen': 'bed-double',
};

const footprint = (it: PlannedItem) => {
  const e = getEntry(it.catalogId);
  if (!e) return null;
  return boxCorners(
    it.position,
    e.defaultSize.w * it.scale.x,
    e.defaultSize.d * it.scale.z,
    it.rotation,
  );
};

/** The rectangle a person of the walkway's width sweeps between two points. */
function path(a: Point, b: Point, width: number): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

/** Where an opening on a room's wall leads into the room: half a metre inside. */
function inside(room: PlannedRoom, o: PlannedOpening): Point {
  const r = room.rect;
  const eps = 0.06;
  const d = 0.5;
  if (Math.abs(o.at.y - r.y) < eps) return { x: o.at.x, y: o.at.y + d };
  if (Math.abs(o.at.y - (r.y + r.h)) < eps) return { x: o.at.x, y: o.at.y - d };
  if (Math.abs(o.at.x - r.x) < eps) return { x: o.at.x + d, y: o.at.y };
  return { x: o.at.x - d, y: o.at.y };
}

/** Rooms where the walkway between two doors is blocked by furniture (and which items block it). */
export function blockedWalkways(
  rooms: PlannedRoom[],
  openings: PlannedOpening[],
  items: PlannedItem[],
): { room: string; items: PlannedItem[] }[] {
  const out: { room: string; items: PlannedItem[] }[] = [];
  for (const room of rooms) {
    if (room.void || room.type === 'outdoor') continue;
    const doors = openings.filter(
      (o) => o.kind !== 'window' && o.level === room.level && o.rooms.includes(room.key),
    );
    if (doors.length < 2) continue;
    // Flat things (rugs) can be walked over.
    const mine = items.filter(
      (i) =>
        i.room === room.key &&
        i.elevation < 0.3 &&
        (getEntry(i.catalogId)?.defaultSize.h ?? 1) > 0.06,
    );
    const blockers = new Set<PlannedItem>();
    for (let i = 0; i < doors.length; i++)
      for (let j = i + 1; j < doors.length; j++) {
        const p = path(inside(room, doors[i]!), inside(room, doors[j]!), WALKWAY_WIDTH);
        for (const it of mine) {
          const fp = footprint(it);
          if (fp && overlapDepth(fp, p) > 0.02) blockers.add(it);
        }
      }
    if (blockers.size) out.push({ room: room.key, items: [...blockers] });
  }
  return out;
}

/** Removes the decor that blocks a walkway; returns the items left and the rooms still blocked by real furniture. */
export function clearWalkways(
  rooms: PlannedRoom[],
  openings: PlannedOpening[],
  items: PlannedItem[],
): { items: PlannedItem[]; blocked: string[] } {
  let left = items;
  for (let pass = 0; pass < 3; pass++) {
    const blocked = blockedWalkways(rooms, openings, left);
    const blockers = new Set(blocked.flatMap((b) => b.items));
    if (!blockers.size) break;
    const swap = new Map<PlannedItem, PlannedItem>();
    const drop = new Set<PlannedItem>();
    for (const it of blockers) {
      const smaller = SMALLER[it.catalogId];
      if (smaller) swap.set(it, { ...it, catalogId: smaller });
      else if (DECOR.has(it.catalogId)) drop.add(it);
    }
    if (!swap.size && !drop.size) break;
    left = left.filter((i) => !drop.has(i)).map((i) => swap.get(i) ?? i);
  }
  return { items: left, blocked: blockedWalkways(rooms, openings, left).map((b) => b.room) };
}
