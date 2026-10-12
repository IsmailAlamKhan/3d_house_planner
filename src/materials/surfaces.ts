import * as ops from '../model/ops';
import type { WallFaceField } from '../model/ops';
import type { Project } from '../model/types';

/** A paintable surface of the model. */
export type Surface =
  | { type: 'wall'; wallId: string; field: WallFaceField }
  | { type: 'floor'; roomId: string }
  | { type: 'ceiling'; roomId: string }
  | { type: 'item'; itemId: string };

/** The material id currently on a surface (undefined if the surface no longer exists or has none). */
export function readSurface(project: Project, s: Surface): string | undefined {
  switch (s.type) {
    case 'wall':
      return project.walls.find((w) => w.id === s.wallId)?.[s.field];
    case 'floor':
      return project.rooms.find((r) => r.id === s.roomId)?.floorMaterial;
    case 'ceiling':
      return project.rooms.find((r) => r.id === s.roomId)?.ceilingMaterial;
    case 'item': {
      const m = project.items.find((i) => i.id === s.itemId)?.props.material;
      return typeof m === 'string' ? m : undefined;
    }
  }
}

/** Paints one surface (inside an `apply`). */
export function paintSurface(p: Project, s: Surface, material: string): void {
  switch (s.type) {
    case 'wall':
      ops.updateWall(p, s.wallId, { [s.field]: material });
      break;
    case 'floor':
      ops.updateRoom(p, s.roomId, { floorMaterial: material });
      break;
    case 'ceiling':
      ops.updateRoom(p, s.roomId, { ceilingMaterial: material });
      break;
    case 'item':
      ops.paintItemSurface(p, s.itemId, material);
      break;
  }
}
