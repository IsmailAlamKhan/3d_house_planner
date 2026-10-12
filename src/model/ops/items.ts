import { isItemInBounds } from '../integrity';
import type { Item, Point, Project } from '../types';
import { ModelError, getItem, getLevel, newId } from './common';

export type NewItem = Pick<Item, 'levelId' | 'catalogId' | 'position'> & Partial<Omit<Item, 'id'>>;

function assertInBounds(p: Project, levelId: string, position: Point): void {
  getLevel(p, levelId);
  if (!isItemInBounds(p, levelId, position)) {
    throw new ModelError('That item would be outside the apartment', 'err.itemOutside');
  }
}

export function addItem(p: Project, input: NewItem): string {
  assertInBounds(p, input.levelId, input.position);
  const id = newId();
  p.items.push({
    id,
    levelId: input.levelId,
    catalogId: input.catalogId,
    position: { ...input.position },
    elevation: input.elevation ?? 0,
    rotation: input.rotation ?? 0,
    scale: input.scale ?? { x: 1, y: 1, z: 1 },
    props: { ...(input.props ?? {}) },
  });
  return id;
}

export function updateItem(
  p: Project,
  id: string,
  patch: Partial<Omit<Item, 'id' | 'levelId'>>,
): void {
  const item = getItem(p, id);
  if (patch.position) assertInBounds(p, item.levelId, patch.position);
  Object.assign(item, patch);
}

export function moveItem(p: Project, id: string, position: Point): void {
  updateItem(p, id, { position: { ...position } });
}

export function rotateItem(p: Project, id: string, rotation: number): void {
  updateItem(p, id, { rotation });
}
