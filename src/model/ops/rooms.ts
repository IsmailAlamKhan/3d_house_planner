import { polygonArea } from '../../geometry/polygon';
import type { Column, Project, Roof, Room, Stair } from '../types';
import { ModelError, getLevel, getRoom, getStair, newId } from './common';

export type NewRoom = Pick<Room, 'levelId' | 'polygon'> & Partial<Omit<Room, 'id'>>;

const badPolygon = (poly: { x: number; y: number }[]) =>
  poly.length < 3 || polygonArea(poly) < 0.01;

export function addRoom(p: Project, input: NewRoom): string {
  getLevel(p, input.levelId);
  if (badPolygon(input.polygon))
    throw new ModelError('A room needs at least 3 corners and some area', 'err.roomCorners');
  const id = newId();
  p.rooms.push({
    id,
    levelId: input.levelId,
    name: input.name ?? 'Room',
    type: input.type ?? 'other',
    polygon: input.polygon.map((pt) => ({ ...pt })),
    floorMaterial: input.floorMaterial ?? 'floor-oak',
    ceilingMaterial: input.ceilingMaterial ?? 'paint-white',
    ceilingHeight: input.ceilingHeight,
    doubleHeight: input.doubleHeight ?? false,
  });
  return id;
}

/** Height of a parapet (m): a waist-high wall instead of a full-height one. */
export const PARAPET_HEIGHT = 1.0;

/** The walls of a level that run along the edges of a room's outline. */
export function parapetWallsOf(p: Project, roomId: string) {
  const room = getRoom(p, roomId);
  const onEdge = (pt: { x: number; y: number }) =>
    room.polygon.some((a, i) => {
      const b = room.polygon[(i + 1) % room.polygon.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
      return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)) < 0.2;
    });
  return p.walls.filter((w) => w.levelId === room.levelId && onEdge(w.start) && onEdge(w.end));
}

/** Turns the walls around an outdoor room into a low parapet (or back to full height). */
export function setRoomParapet(p: Project, roomId: string, on: boolean): void {
  for (const w of parapetWallsOf(p, roomId)) {
    if (on) w.height = PARAPET_HEIGHT;
    else delete w.height;
  }
}

export function updateRoom(
  p: Project,
  id: string,
  patch: Partial<Omit<Room, 'id' | 'levelId'>>,
): void {
  const room = getRoom(p, id);
  if (patch.polygon && badPolygon(patch.polygon)) {
    throw new ModelError('A room needs at least 3 corners and some area', 'err.roomCorners');
  }
  Object.assign(room, patch);
}

export type NewStair = Pick<Stair, 'fromLevelId' | 'toLevelId' | 'position'> &
  Partial<Omit<Stair, 'id'>>;

export function addStair(p: Project, input: NewStair): string {
  getLevel(p, input.fromLevelId);
  getLevel(p, input.toLevelId);
  if (input.fromLevelId === input.toLevelId) {
    throw new ModelError('A stair must connect two different levels', 'err.stairLevels');
  }
  const id = newId();
  p.stairs.push({
    id,
    fromLevelId: input.fromLevelId,
    toLevelId: input.toLevelId,
    type: input.type ?? 'straight',
    position: { ...input.position },
    rotation: input.rotation ?? 0,
    width: input.width ?? 1,
    riserHeight: input.riserHeight,
    treadDepth: input.treadDepth,
    railing: input.railing ?? true,
  });
  return id;
}

export function updateStair(p: Project, id: string, patch: Partial<Omit<Stair, 'id'>>): void {
  Object.assign(getStair(p, id), patch);
}

export type NewColumn = Pick<Column, 'levelId' | 'position'> & Partial<Omit<Column, 'id'>>;

export function addColumn(p: Project, input: NewColumn): string {
  getLevel(p, input.levelId);
  const id = newId();
  p.columns.push({
    id,
    levelId: input.levelId,
    position: { ...input.position },
    size: input.size ?? { w: 0.3, d: 0.3 },
    shape: input.shape ?? 'rect',
    structural: true,
    locked: true,
  });
  return id;
}

export type NewRoof = Pick<Roof, 'levelId' | 'kind' | 'polygon'>;

export function addRoof(p: Project, input: NewRoof): string {
  getLevel(p, input.levelId);
  const id = newId();
  p.roofs.push({
    id,
    levelId: input.levelId,
    kind: input.kind,
    polygon: input.polygon.map((pt) => ({ ...pt })),
  });
  return id;
}
