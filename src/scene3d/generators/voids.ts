import type { Vec2 } from '../../geometry/vec';
import type { Level, Project } from '../../model/types';
import { layoutStair, stairVoidPlan } from './stairs';

/**
 * Openings in the slab of `level` (the floor everyone stands on at that level):
 * stairs arriving from below, `void` roof features on the level, and double-height rooms on the level below.
 */
export function slabVoids(project: Project, level: Level): Vec2[][] {
  const out: Vec2[][] = [];
  for (const stair of project.stairs.filter((s) => s.toLevelId === level.id)) {
    const from = project.levels.find((l) => l.id === stair.fromLevelId);
    if (!from) continue;
    out.push(...stairVoidPlan(stair, layoutStair(stair, from, level)));
  }
  for (const r of project.roofs)
    if (r.levelId === level.id && r.kind === 'void') out.push(r.polygon);
  out.push(...doubleHeightVoids(project, level).map((v) => v.polygon));
  return out;
}

/** Openings in `level`'s floor above double-height rooms of the level below (with the room they belong to). */
export function doubleHeightVoids(
  project: Project,
  level: Level,
): { roomId: string; polygon: Vec2[] }[] {
  const below = project.levels.find((l) => l.index === level.index - 1);
  if (!below) return [];
  return project.rooms
    .filter((r) => r.levelId === below.id && r.doubleHeight)
    .map((r) => ({ roomId: r.id, polygon: r.polygon }));
}

/** The level directly above `level`, if any. */
export const levelAbove = (project: Project, level: Level): Level | undefined =>
  project.levels.find((l) => l.index === level.index + 1);
