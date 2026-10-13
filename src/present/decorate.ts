import { getEntry, itemSize } from '../catalog';
import { placeItem } from '../catalog/placement';
import { boxCorners } from '../geometry/collide';
import { pointInPolygon, polygonArea, polygonBounds } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec';
import * as ops from '../model/ops';
import { useModel } from '../model/store';
import type { Item, Project, Room } from '../model/types';

/** Rooms that get no decor (circulation, voids, bathrooms where it would crowd the fittings). */
const SKIP = new Set(['corridor', 'stair', 'bathroom', 'utility', 'laundry', 'pantry', 'garage']);
const SEATING = ['sofa-2seat', 'sofa-3seat', 'sofa-l', 'theatre-sofa', 'lounge-set'];
const BEDS = ['bed-single', 'bed-double', 'bed-queen', 'bed-king'];
const TABLES = ['coffee-table', 'dining-table-4', 'dining-table-6', 'dining-table-8', 'side-table'];

const inRoom = (room: Room, pt: Vec2) => pointInPolygon(pt, room.polygon, 0.01);
const front = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });

/** Points just inside each corner of a room, along the corner's bisector. */
function cornerSpots(room: Room, inset: number): Vec2[] {
  const out: Vec2[] = [];
  const n = room.polygon.length;
  room.polygon.forEach((c, i) => {
    const a = room.polygon[(i + n - 1) % n]!;
    const b = room.polygon[(i + 1) % n]!;
    const u = { x: a.x - c.x, y: a.y - c.y };
    const v = { x: b.x - c.x, y: b.y - c.y };
    const lu = Math.hypot(u.x, u.y) || 1;
    const lv = Math.hypot(v.x, v.y) || 1;
    const dir = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv };
    const ld = Math.hypot(dir.x, dir.y);
    if (ld < 0.2) return;
    const p = { x: c.x + (dir.x / ld) * inset, y: c.y + (dir.y / ld) * inset };
    if (inRoom(room, p)) out.push(p);
  });
  return out;
}

/** Distance from a point to the nearest door or archway of the room's level. */
function doorDistance(p: Project, levelId: string, at: Vec2): number {
  let best = Infinity;
  for (const o of p.openings) {
    if (o.kind === 'window') continue;
    const w = p.walls.find((x) => x.id === o.wallId);
    if (!w || w.levelId !== levelId) continue;
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
    const c = {
      x: w.start.x + ((w.end.x - w.start.x) / len) * o.offset,
      y: w.start.y + ((w.end.y - w.start.y) / len) * o.offset,
    };
    best = Math.min(best, Math.hypot(c.x - at.x, c.y - at.y) - o.width / 2);
  }
  return best;
}

/** Adds an item if it can be placed without a clearance warning; returns whether it was added. */
function tryAdd(
  p: Project,
  levelId: string,
  catalogId: string,
  at: Vec2,
  extra: Partial<Pick<Item, 'rotation' | 'elevation' | 'scale' | 'props'>> & {
    free?: boolean;
  } = {},
): boolean {
  const entry = getEntry(catalogId);
  if (!entry) return false;
  const placed = placeItem(p, levelId, entry, at, {
    rotation: extra.rotation,
    scale: extra.scale,
    snapWalls: extra.free ? false : undefined,
  });
  if (!placed.ok || placed.warnings.length) return false;
  try {
    ops.addItem(p, {
      levelId,
      catalogId,
      position: placed.position,
      rotation: extra.free ? (extra.rotation ?? 0) : placed.rotation,
      elevation: extra.elevation ?? placed.elevation,
      scale: extra.scale,
      props: extra.props,
    });
    return true;
  } catch {
    return false;
  }
}

function decorateRoom(p: Project, room: Room): number {
  let added = 0;
  const here = (cid: (id: string) => boolean) =>
    p.items.filter(
      (i) => i.levelId === room.levelId && inRoom(room, i.position) && cid(i.catalogId),
    );
  const has = (prefix: string) => here((id) => id.startsWith(prefix)).length > 0;
  const area = polygonArea(room.polygon);
  const level = room.levelId;

  if (room.type === 'outdoor') {
    // A planter along the longest edge and a large plant in the corners.
    const b = polygonBounds(room.polygon);
    if (!has('planter-box')) {
      const horizontal = b.max.x - b.min.x >= b.max.y - b.min.y;
      const at = horizontal
        ? { x: (b.min.x + b.max.x) / 2, y: b.min.y + 0.45 }
        : { x: b.min.x + 0.45, y: (b.min.y + b.max.y) / 2 };
      if (tryAdd(p, level, 'planter-box', at, { rotation: horizontal ? 0 : Math.PI / 2 })) added++;
    }
    if (!has('plant-')) {
      for (const s of cornerSpots(room, 0.5).slice(0, 2))
        if (tryAdd(p, level, 'plant-large', s, { free: true, props: { species: 'palm' } })) added++;
    }
    return added;
  }

  // Rugs under seating and at the foot of beds.
  if (!has('rug')) {
    const seat = here((id) => SEATING.includes(id))[0];
    const bed = here((id) => BEDS.includes(id))[0];
    if (seat) {
      const e = getEntry(seat.catalogId)!;
      const s = itemSize(e, seat.scale);
      const f = front(seat.rotation);
      const d = s.d / 2 + 0.75;
      const at = { x: seat.position.x + f.x * d, y: seat.position.y + f.y * d };
      const wide = Math.max(2, Math.min(3.2, s.w * 0.95));
      if (
        tryAdd(p, level, 'rug', at, {
          rotation: seat.rotation,
          free: true,
          scale: { x: wide / 2, y: 1, z: 1.2 },
          props: { pattern: 'geometric', color: '#c9bfae' },
        })
      )
        added++;
    } else if (bed) {
      const e = getEntry(bed.catalogId)!;
      const s = itemSize(e, bed.scale);
      const f = front(bed.rotation);
      const at = {
        x: bed.position.x + f.x * (s.d / 2 - 0.1),
        y: bed.position.y + f.y * (s.d / 2 - 0.1),
      };
      if (
        tryAdd(p, level, 'rug', at, {
          rotation: bed.rotation,
          free: true,
          scale: { x: Math.max(2.2, s.w + 0.8) / 2, y: 1, z: 1.3 },
          props: { pattern: 'border', color: '#b9aea0' },
        })
      )
        added++;
    }
  }

  // Lamps beside the bed (on a bedside table when there is one).
  if (room.type === 'bedroom' && !has('table-lamp') && !has('floor-lamp')) {
    const side = here((id) => id === 'side-table')[0];
    if (side) {
      const e = getEntry(side.catalogId)!;
      const top = itemSize(e, side.scale).h;
      if (tryAdd(p, level, 'table-lamp', side.position, { free: true, elevation: top })) added++;
    } else {
      const bed = here((id) => BEDS.includes(id))[0];
      if (bed) {
        const e = getEntry(bed.catalogId)!;
        const s = itemSize(e, bed.scale);
        const f = front(bed.rotation);
        const right = { x: f.y, y: -f.x };
        const at = {
          x: bed.position.x + right.x * (s.w / 2 + 0.4) - f.x * (s.d / 2 - 0.3),
          y: bed.position.y + right.y * (s.w / 2 + 0.4) - f.y * (s.d / 2 - 0.3),
        };
        if (tryAdd(p, level, 'floor-lamp', at, { free: true })) added++;
      }
    }
  }

  // A vase or bowl on a table.
  if (!has('vase-bowl')) {
    const table = here((id) => TABLES.includes(id)).find((i) => !i.catalogId.startsWith('side'));
    if (table) {
      const e = getEntry(table.catalogId)!;
      const top = itemSize(e, table.scale).h;
      const kind = table.catalogId.startsWith('dining') ? 'bowl' : 'vase';
      if (
        tryAdd(p, level, 'vase-bowl', table.position, {
          free: true,
          elevation: top,
          props: { kind },
        })
      )
        added++;
    }
  }

  // Plants in the corners farthest from doors.
  if (!has('plant-')) {
    const spots = cornerSpots(room, 0.45).sort(
      (a, b) => doorDistance(p, level, b) - doorDistance(p, level, a),
    );
    const want = area > 30 ? 2 : 1;
    let n = 0;
    for (const s of spots) {
      if (n >= want) break;
      if (doorDistance(p, level, s) < 1.0) continue;
      const big = area > 18;
      if (
        tryAdd(p, level, big ? 'plant-large' : 'plant-medium', s, {
          free: true,
          props: { species: n ? 'rubber' : 'fern' },
        })
      ) {
        n++;
        added++;
      }
    }
  }

  // Art on the longest empty wall.
  if (!has('wall-art') && area > 8) {
    const edges = room.polygon
      .map((a, i) => {
        const b = room.polygon[(i + 1) % room.polygon.length]!;
        return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
      })
      .filter((e) => e.len > 2.2)
      .sort((x, y) => y.len - x.len);
    const c = (() => {
      const q = polygonBounds(room.polygon);
      return { x: (q.min.x + q.max.x) / 2, y: (q.min.y + q.max.y) / 2 };
    })();
    for (const e of edges) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const inward = { x: c.x - mid.x, y: c.y - mid.y };
      const li = Math.hypot(inward.x, inward.y) || 1;
      const at = { x: mid.x + (inward.x / li) * 0.15, y: mid.y + (inward.y / li) * 0.15 };
      if (doorDistance(p, level, mid) < 1.4) continue;
      // Not behind tall furniture: check that no item stands against the wall at that spot.
      const blocked = p.items.some((i) => {
        if (i.levelId !== level) return false;
        const ie = getEntry(i.catalogId);
        if (!ie) return false;
        const s = itemSize(ie, i.scale);
        if (s.h < 0.9) return false;
        return boxCorners(i.position, s.w, s.d, i.rotation).some(
          (k) => Math.hypot(k.x - mid.x, k.y - mid.y) < 0.9,
        );
      });
      if (blocked) continue;
      const style = ['abstract', 'landscape', 'botanical'][added % 3]!;
      if (tryAdd(p, level, 'wall-art', at, { props: { style } })) {
        added++;
        break;
      }
    }
  }
  return added;
}

/**
 * Adds tasteful decor to every room (or the rooms of one level): plants in corners away from doors, rugs under
 * seating and beds, lamps by beds, vases on tables, art on empty walls, planters outdoors. Respects clearances, skips
 * rooms that already have a piece of each kind, and is ONE undoable step. Returns how many items were added.
 */
export function autoDecorateProject(p: Project, levelId?: string): number {
  let n = 0;
  for (const room of p.rooms) {
    if (levelId && room.levelId !== levelId) continue;
    if (room.name === 'Open to below' || SKIP.has(room.type)) continue;
    n += decorateRoom(p, room);
  }
  return n;
}

export function autoDecorate(levelId?: string): number {
  return useModel.getState().apply((p) => autoDecorateProject(p, levelId));
}
