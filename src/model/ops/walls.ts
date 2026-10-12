import { dist, lerp } from '../../geometry/vec';
import {
  MIN_WALL_LENGTH,
  isWallLengthValid,
  openingFitsWall,
  wallHeight,
  wallLength,
} from '../integrity';
import type { Point, Project, Wall } from '../types';
import { ModelError, clone, getLevel, getWall, newId } from './common';

export type NewWall = Pick<Wall, 'levelId' | 'start' | 'end'> & Partial<Omit<Wall, 'id'>>;

export function addWall(p: Project, input: NewWall): string {
  getLevel(p, input.levelId);
  if (!isWallLengthValid(input.start, input.end)) {
    throw new ModelError(`Wall must be at least ${MIN_WALL_LENGTH} m long`);
  }
  const id = newId();
  p.walls.push({
    id,
    levelId: input.levelId,
    start: { ...input.start },
    end: { ...input.end },
    thickness: input.thickness ?? p.settings.defaultWallThickness,
    height: input.height,
    type: input.type ?? 'interior',
    materialInside: input.materialInside ?? 'paint-white',
    materialOutside: input.materialOutside ?? 'paint-white',
    locked: input.locked ?? false,
  });
  return id;
}

export function updateWall(
  p: Project,
  id: string,
  patch: Partial<Omit<Wall, 'id' | 'levelId'>>,
): void {
  const wall = getWall(p, id);
  const next = { ...wall, ...patch };
  if (!isWallLengthValid(next.start, next.end)) {
    throw new ModelError(`Wall must be at least ${MIN_WALL_LENGTH} m long`);
  }
  const len = wallLength(next);
  const height = wallHeight(p, next);
  for (const o of p.openings.filter((o) => o.wallId === id)) {
    if (!openingFitsWall(len, o.offset, o.width)) {
      throw new ModelError('Wall is too short for the openings on it');
    }
    if (o.sillHeight + o.height > height + 1e-9) {
      throw new ModelError('Wall is too low for the openings on it');
    }
  }
  Object.assign(wall, patch);
}

/**
 * Splits a wall at `at` (a distance along the wall from `start`, or a point projected onto it).
 * The first half keeps the original id. Openings move to whichever half contains them;
 * an opening straddling the split point makes the split invalid. Returns [firstId, secondId].
 */
export function splitWall(p: Project, id: string, at: number | Point): [string, string] {
  const wall = getWall(p, id);
  const len = wallLength(wall);
  let d: number;
  if (typeof at === 'number') {
    d = at;
  } else {
    const abx = wall.end.x - wall.start.x;
    const aby = wall.end.y - wall.start.y;
    d = ((at.x - wall.start.x) * abx + (at.y - wall.start.y) * aby) / len;
  }
  if (d < MIN_WALL_LENGTH || len - d < MIN_WALL_LENGTH) {
    throw new ModelError('Split point leaves a wall that is too short');
  }
  const mid = lerp(wall.start, wall.end, d / len);
  const openings = p.openings.filter((o) => o.wallId === id);
  for (const o of openings) {
    if (o.offset - o.width / 2 < d && o.offset + o.width / 2 > d) {
      throw new ModelError('Cannot split a wall through a door or window');
    }
  }
  const secondId = newId();
  p.walls.push({ ...clone(wall), id: secondId, start: mid, end: { ...wall.end } });
  wall.end = { ...mid };
  for (const o of openings) {
    if (o.offset > d) {
      o.wallId = secondId;
      o.offset -= d;
    }
  }
  return [id, secondId];
}

/** Deletes a wall and every opening on it. */
export function deleteWall(p: Project, id: string): void {
  getWall(p, id);
  p.openings = p.openings.filter((o) => o.wallId !== id);
  p.walls = p.walls.filter((w) => w.id !== id);
}

/** Point on a wall at distance `d` from its start. */
export function pointOnWall(wall: Wall, d: number): Point {
  const len = dist(wall.start, wall.end);
  return lerp(wall.start, wall.end, len === 0 ? 0 : d / len);
}
