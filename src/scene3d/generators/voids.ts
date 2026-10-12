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
  const below = project.levels.find((l) => l.index === level.index - 1);
  if (below) {
    for (const room of project.rooms)
      if (room.levelId === below.id && room.doubleHeight) out.push(room.polygon);
  }
  return out;
}

/** The level directly above `level`, if any. */
export const levelAbove = (project: Project, level: Level): Level | undefined =>
  project.levels.find((l) => l.index === level.index + 1);
