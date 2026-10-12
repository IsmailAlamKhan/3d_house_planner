import type { Surface } from '../materials/surfaces';
import { faceField } from '../model/ops';
import type { Project } from '../model/types';
import type { AnyPart } from './generators/common';
import { isObjectPart } from './generators/common';

/**
 * The paintable surface a 3D click landed on. For walls the clicked face (material group 0 = left of the wall,
 * 1 = right, 2 = edges) decides between the inside and outside finish.
 */
export function surfaceFromPart(
  project: Project,
  part: AnyPart,
  materialIndex: number | undefined,
): Surface | null {
  const e = part.entity;
  if (!e) return null;
  if (e.type === 'item') return { type: 'item', itemId: e.id };
  if (isObjectPart(part)) return null;
  if (e.type === 'room')
    return part.layer === 'ceiling'
      ? { type: 'ceiling', roomId: e.id }
      : part.layer === 'floor'
        ? { type: 'floor', roomId: e.id }
        : null;
  if (e.type === 'wall' && (materialIndex === 0 || materialIndex === 1)) {
    const wall = project.walls.find((w) => w.id === e.id);
    return wall
      ? {
          type: 'wall',
          wallId: wall.id,
          field: faceField(project, wall, materialIndex === 0 ? 'left' : 'right'),
        }
      : null;
  }
  return null;
}
