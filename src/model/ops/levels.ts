import type { Level, Project } from '../types';
import { ModelError, getLevel, newId } from './common';

/** Elevation = top of the level's finished floor. Level N sits on its slab above the previous ceiling. */
export function recomputeLevels(p: Project): void {
  p.levels.sort((a, b) => a.index - b.index);
  let elevation = 0;
  p.levels.forEach((level, i) => {
    level.index = i;
    if (i > 0) {
      const below = p.levels[i - 1]!;
      elevation = below.elevation + below.floorToCeiling + level.slabThickness;
    }
    level.elevation = elevation;
  });
}

export type NewLevel = Partial<Omit<Level, 'id' | 'index' | 'elevation'>>;

export function addLevel(p: Project, input: NewLevel = {}): string {
  const id = newId();
  p.levels.push({
    id,
    name: input.name ?? `Level ${p.levels.length + 1}`,
    index: p.levels.length,
    elevation: 0,
    floorToCeiling: input.floorToCeiling ?? 2.7,
    slabThickness: input.slabThickness ?? 0.2,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
  });
  recomputeLevels(p);
  return id;
}

export function updateLevel(p: Project, id: string, patch: NewLevel): void {
  Object.assign(getLevel(p, id), patch);
  recomputeLevels(p);
}

/** Reorders levels to match `orderedIds` (must list every level exactly once). */
export function reorderLevels(p: Project, orderedIds: string[]): void {
  const same =
    orderedIds.length === p.levels.length &&
    new Set(orderedIds).size === orderedIds.length &&
    p.levels.every((l) => orderedIds.includes(l.id));
  if (!same) throw new ModelError('reorderLevels needs every level id exactly once');
  orderedIds.forEach((levelId, i) => {
    getLevel(p, levelId).index = i;
  });
  recomputeLevels(p);
}
