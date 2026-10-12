import { pointInPolygon, polygonArea } from '../../geometry/polygon';
import { detectRoomPolygons, matchRooms, polygonIoU, samePolygon } from '../../geometry/rooms';
import { dist, projectOnSegment, sub } from '../../geometry/vec';
import { MIN_WALL_LENGTH } from '../integrity';
import type { Point, Project, Wall } from '../types';
import { ModelError, getLevel, getRoom, newId } from './common';
import { addWall, updateWall, type NewWall } from './walls';

const ON_WALL_TOL = 1e-3;

/**
 * Re-detects rooms on a level from its wall centerlines. Existing rooms keep their name, type and
 * materials when their shape changes (matched by overlap); new regions get new rooms; rooms whose
 * region no longer exists are removed. Unchanged rooms are left untouched.
 */
export function syncRooms(p: Project, levelId: string): void {
  getLevel(p, levelId);
  const detected = detectRoomPolygons(p.walls.filter((w) => w.levelId === levelId));
  const existing = p.rooms.filter((r) => r.levelId === levelId);
  const { matches, unmatchedDetected, unmatchedExisting } = matchRooms(
    existing.map((r) => ({ id: r.id, polygon: r.polygon })),
    detected,
  );
  for (const [d, id] of matches) {
    const room = getRoom(p, id);
    const poly = detected[d]!;
    if (!samePolygon(room.polygon, poly)) room.polygon = poly.map((pt) => ({ ...pt }));
  }
  const gone = new Set(unmatchedExisting);
  if (gone.size) p.rooms = p.rooms.filter((r) => !gone.has(r.id));
  let n = p.rooms.filter((r) => r.levelId === levelId).length;
  for (const d of unmatchedDetected) {
    p.rooms.push({
      id: newId(),
      levelId,
      name: `Room ${++n}`,
      type: 'other',
      polygon: detected[d]!.map((pt) => ({ ...pt })),
      floorMaterial: 'floor-oak',
      ceilingMaterial: 'paint-white',
      doubleHeight: false,
    });
  }
}

const covered = (walls: Wall[], a: Point, b: Point): boolean =>
  walls.some(
    (w) =>
      projectOnSegment(a, w.start, w.end).distance < ON_WALL_TOL &&
      projectOnSegment(b, w.start, w.end).distance < ON_WALL_TOL,
  );

/**
 * Adds walls along a polyline (closed = also from the last point back to the first).
 * Segments that are too short or already lie on an existing wall are skipped. Then rooms are re-detected.
 * Returns the ids of the new walls.
 */
export function addWallChain(
  p: Project,
  levelId: string,
  points: Point[],
  opts: { closed?: boolean; wall?: Partial<NewWall> } = {},
): string[] {
  getLevel(p, levelId);
  const ids: string[] = [];
  const n = opts.closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (dist(a, b) < MIN_WALL_LENGTH) continue;
    if (
      covered(
        p.walls.filter((w) => w.levelId === levelId),
        a,
        b,
      )
    )
      continue;
    ids.push(addWall(p, { ...opts.wall, levelId, start: a, end: b }));
  }
  syncRooms(p, levelId);
  return ids;
}

/** Draws walls around `polygon` and creates its room in one step. Returns the room id, if one was found. */
export function addRoomWithWalls(
  p: Project,
  levelId: string,
  polygon: Point[],
  wall?: Partial<NewWall>,
): string | undefined {
  if (polygonArea(polygon) < 0.01) return undefined;
  addWallChain(p, levelId, polygon, { closed: true, wall });
  let best: { id: string; score: number } | undefined;
  for (const r of p.rooms.filter((r) => r.levelId === levelId)) {
    const score = polygonIoU(r.polygon, polygon);
    if (score > (best?.score ?? 0.5)) best = { id: r.id, score };
  }
  return best?.id;
}

export interface WallGeometry {
  id: string;
  start: Point;
  end: Point;
}

/** Applies new centerlines to walls (move / endpoint drag) and re-detects rooms on their level. */
export function setWallGeometry(p: Project, geometry: WallGeometry[]): void {
  const levels = new Set<string>();
  for (const g of geometry) {
    updateWall(p, g.id, { start: g.start, end: g.end });
    levels.add(p.walls.find((w) => w.id === g.id)!.levelId);
  }
  for (const l of levels) syncRooms(p, l);
}

/** Deletes walls and re-detects rooms. (Use `deleteSelection` for generic deletes of other entity types.) */
export function deleteWallsAndSync(p: Project, ids: string[]): void {
  const levels = new Set(p.walls.filter((w) => ids.includes(w.id)).map((w) => w.levelId));
  const drop = new Set(ids);
  p.openings = p.openings.filter((o) => !drop.has(o.wallId));
  p.walls = p.walls.filter((w) => !drop.has(w.id));
  for (const l of levels) syncRooms(p, l);
}

/** Walls that bound `roomId` (both ends and midpoint on its outline) and are not shared with another room. */
export function exclusiveWallsOfRoom(p: Project, roomId: string): string[] {
  const room = getRoom(p, roomId);
  const others = p.rooms.filter((r) => r.levelId === room.levelId && r.id !== roomId);
  const onOutline = (pt: Point) =>
    room.polygon.some(
      (a, i) =>
        projectOnSegment(pt, a, room.polygon[(i + 1) % room.polygon.length]!).distance <
        ON_WALL_TOL,
    );
  return p.walls
    .filter((w) => w.levelId === room.levelId)
    .filter((w) => {
      const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
      if (!onOutline(w.start) || !onOutline(w.end) || !onOutline(mid)) return false;
      const d = sub(w.end, w.start);
      const len = Math.hypot(d.x, d.y);
      const nrm = { x: -d.y / len, y: d.x / len };
      const probe = w.thickness / 2 + 0.1;
      const sides = [
        { x: mid.x + nrm.x * probe, y: mid.y + nrm.y * probe },
        { x: mid.x - nrm.x * probe, y: mid.y - nrm.y * probe },
      ];
      return !sides.some((s) => others.some((o) => pointInPolygon(s, o.polygon)));
    })
    .map((w) => w.id);
}

/** Removes a room along with the walls only it uses (shared walls stay). */
export function deleteRoomWithWalls(p: Project, roomId: string): void {
  deleteWallsAndSync(p, exclusiveWallsOfRoom(p, roomId));
  p.rooms = p.rooms.filter((r) => r.id !== roomId);
}

/**
 * Starts a level from the one below it: adds every wall of the lower level that the level does not already have
 * (same type, thickness and finishes; doors and windows are not copied), then re-detects rooms.
 * Returns how many walls were added.
 */
export function copyWallsFromBelow(p: Project, levelId: string): number {
  const level = getLevel(p, levelId);
  const below = p.levels.find((l) => l.index === level.index - 1);
  if (!below) throw new ModelError('There is no level below to copy from.');
  const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
  let added = 0;
  for (const w of p.walls.filter((x) => x.levelId === below.id)) {
    const exists = p.walls.some(
      (x) =>
        x.levelId === levelId &&
        ((same(x.start, w.start) && same(x.end, w.end)) ||
          (same(x.start, w.end) && same(x.end, w.start))),
    );
    if (exists) continue;
    addWall(p, {
      levelId,
      start: w.start,
      end: w.end,
      thickness: w.thickness,
      height: w.height,
      type: w.type,
      materialInside: w.materialInside,
      materialOutside: w.materialOutside,
    });
    added++;
  }
  syncRooms(p, levelId);
  return added;
}
