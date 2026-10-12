import type { Part } from './generators/common';
import { NO_SELECTION, useModel } from '../model/store';
import type { Project } from '../model/types';

type Entity = NonNullable<Part['entity']>;

/** The level an entity lives on (for stairs: the level they start on). */
export function entityLevelId(project: Project, e: Entity): string | undefined {
  switch (e.type) {
    case 'wall':
      return project.walls.find((x) => x.id === e.id)?.levelId;
    case 'opening': {
      const o = project.openings.find((x) => x.id === e.id);
      return project.walls.find((w) => w.id === o?.wallId)?.levelId;
    }
    case 'room':
      return project.rooms.find((x) => x.id === e.id)?.levelId;
    case 'column':
      return project.columns.find((x) => x.id === e.id)?.levelId;
    case 'item':
      return project.items.find((x) => x.id === e.id)?.levelId;
    case 'roof':
      return project.roofs.find((x) => x.id === e.id)?.levelId;
    case 'stair':
      return project.stairs.find((x) => x.id === e.id)?.fromLevelId;
  }
}

/** Selection coming from a click in the 3D view; keeps the 2D view and Properties panel in sync via the store. */
export function selectFrom3d(e: Entity | undefined, additive: boolean): void {
  const s = useModel.getState();
  if (!e) {
    if (!additive) s.setSelection(NO_SELECTION);
    return;
  }
  const levelId = entityLevelId(s.project, e);
  if (levelId && levelId !== s.activeLevelId) s.setActiveLevel(levelId);
  const cur = s.selection;
  if (additive && cur.type === e.type) {
    const ids = cur.ids.includes(e.id) ? cur.ids.filter((i) => i !== e.id) : [...cur.ids, e.id];
    s.setSelection(ids.length ? { type: e.type, ids } : NO_SELECTION);
  } else {
    s.setSelection({ type: e.type, ids: [e.id] });
  }
}
