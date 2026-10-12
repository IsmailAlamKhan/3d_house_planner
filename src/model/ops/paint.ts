import { pointInPolygon } from '../../geometry/polygon';
import { projectOnSegment } from '../../geometry/vec';
import { insideSign } from '../integrity';
import type { Project, Room, Wall } from '../types';
import { getItem, getRoom, getWall } from './common';

export type WallFaceField = 'materialInside' | 'materialOutside';
export type Side = 'left' | 'right';

/** Left/right is relative to the wall's start → end direction. Exterior walls: the inside face looks into the shell. */
export function faceField(project: Project, wall: Wall, side: Side): WallFaceField {
  const leftIsInside = insideSign(wall, project.shell.footprint) === 1;
  return (side === 'left') === leftIsInside ? 'materialInside' : 'materialOutside';
}

/** The side of a wall (relative to start → end) a point lies on. */
export function sideOfWall(wall: Pick<Wall, 'start' | 'end'>, p: { x: number; y: number }): Side {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  return (p.x - wall.start.x) * -dy + (p.y - wall.start.y) * dx >= 0 ? 'left' : 'right';
}

/** A point just off the wall face on `side`, level with `at` along the wall. */
const probeAt = (wall: Wall, at: { x: number; y: number }, side: Side) => {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = (side === 'left' ? 1 : -1) * (wall.thickness / 2 + 0.1);
  return { x: at.x + (-dy / len) * k, y: at.y + (dx / len) * k };
};
const probe = (wall: Wall, side: Side) =>
  probeAt(wall, { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }, side);

/** The room a given face of a wall looks into (if any). */
export function roomOnSide(project: Project, wall: Wall, side: Side): Room | undefined {
  const p = probe(wall, side);
  return project.rooms.find((r) => r.levelId === wall.levelId && pointInPolygon(p, r.polygon));
}

const ON = 1e-3;

/** A room edge that lies along the wall's centerline (the wall may be longer than the edge). */
function edgeAlong(wall: Wall, room: Room): { mid: { x: number; y: number } } | undefined {
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (
      projectOnSegment(a, wall.start, wall.end).distance < ON &&
      projectOnSegment(b, wall.start, wall.end).distance < ON
    ) {
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  }
  return undefined;
}

/** The face of `wall` that looks into `room` (undefined when the wall doesn't run along the room). */
export function faceTowardRoom(
  project: Project,
  wall: Wall,
  room: Room,
): WallFaceField | undefined {
  const edge = edgeAlong(wall, room);
  if (!edge) return undefined;
  for (const side of ['left', 'right'] as const) {
    if (pointInPolygon(probeAt(wall, edge.mid, side), room.polygon))
      return faceField(project, wall, side);
  }
  return undefined;
}

/** Walls that run along an edge of the room's outline. */
export function wallsAroundRoom(project: Project, room: Room): Wall[] {
  return project.walls.filter((w) => w.levelId === room.levelId && edgeAlong(w, room));
}

/** Paints the room-facing face of every wall around a room. */
export function paintRoomWalls(p: Project, roomId: string, material: string): void {
  const room = getRoom(p, roomId);
  for (const wall of wallsAroundRoom(p, room)) {
    const field = faceTowardRoom(p, wall, room);
    if (field) getWall(p, wall.id)[field] = material;
  }
}

/** Sets one face field (inside or outside finish) on every wall of a level. */
export function paintLevelWalls(
  p: Project,
  levelId: string,
  field: WallFaceField,
  material: string,
): void {
  for (const w of p.walls) if (w.levelId === levelId) w[field] = material;
}

export function paintLevelFloors(p: Project, levelId: string, material: string): void {
  for (const r of p.rooms) if (r.levelId === levelId) r.floorMaterial = material;
}

export function paintLevelCeilings(p: Project, levelId: string, material: string): void {
  for (const r of p.rooms) if (r.levelId === levelId) r.ceilingMaterial = material;
}

/** Sets (or, with null, clears) the library material on an item's main surface. */
export function paintItemSurface(p: Project, itemId: string, material: string | null): void {
  const item = getItem(p, itemId);
  if (material === null) delete item.props.material;
  else item.props.material = material;
}
