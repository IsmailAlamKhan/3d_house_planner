import { isItemInBounds } from '../integrity';
import type { EntityType, Project, Selection } from '../types';
import { ModelError, clone, newId } from './common';
import { deleteWall } from './walls';

type Collection = 'walls' | 'openings' | 'rooms' | 'stairs' | 'items' | 'columns' | 'roofs';
type Entity = { id: string };

const COLLECTION: Record<EntityType, Collection> = {
  wall: 'walls',
  opening: 'openings',
  room: 'rooms',
  stair: 'stairs',
  item: 'items',
  column: 'columns',
  roof: 'roofs',
};

const isLocked = (e: object): boolean => 'locked' in e && e.locked === true;
const shift = (pt: { x: number; y: number }) => ({ x: pt.x + 0.5, y: pt.y + 0.5 });

/** Deletes the selected entities. Locked entities (e.g. structural columns) are left alone. Returns deleted ids. */
export function deleteSelection(p: Project, sel: Selection): string[] {
  if (!sel.type) return [];
  const key = COLLECTION[sel.type];
  const deleted: string[] = [];
  for (const id of sel.ids) {
    const entity = (p[key] as Entity[]).find((e) => e.id === id);
    if (!entity || isLocked(entity)) continue;
    if (sel.type === 'wall') deleteWall(p, id);
    else (p[key] as Entity[]) = (p[key] as Entity[]).filter((e) => e.id !== id);
    deleted.push(id);
  }
  return deleted;
}

/** Duplicates the selected entities, nudged by 0.5 m. Walls bring their openings. Returns the new ids. */
export function duplicate(p: Project, sel: Selection): string[] {
  if (!sel.type) return [];
  if (sel.type === 'column')
    throw new ModelError('Structural columns cannot be duplicated', 'err.columnDup');
  if (sel.type === 'opening')
    throw new ModelError('Add a new door or window instead of duplicating', 'err.openingDup');
  const created: string[] = [];
  for (const id of sel.ids) {
    const nid = newId();
    switch (sel.type) {
      case 'wall': {
        const src = p.walls.find((w) => w.id === id);
        if (!src) continue;
        p.walls.push({
          ...clone(src),
          id: nid,
          start: shift(src.start),
          end: shift(src.end),
          locked: false,
        });
        for (const o of p.openings.filter((o) => o.wallId === id)) {
          p.openings.push({ ...clone(o), id: newId(), wallId: nid });
        }
        break;
      }
      case 'room': {
        const src = p.rooms.find((r) => r.id === id);
        if (!src) continue;
        p.rooms.push({ ...clone(src), id: nid, polygon: src.polygon.map(shift) });
        break;
      }
      case 'stair': {
        const src = p.stairs.find((s) => s.id === id);
        if (!src) continue;
        p.stairs.push({ ...clone(src), id: nid, position: shift(src.position) });
        break;
      }
      case 'item': {
        const src = p.items.find((i) => i.id === id);
        if (!src) continue;
        // Nudge diagonally, trying every direction until the copy stays inside the apartment.
        const spot =
          [
            shift(src.position),
            { x: src.position.x - 0.5, y: src.position.y + 0.5 },
            { x: src.position.x + 0.5, y: src.position.y - 0.5 },
            { x: src.position.x - 0.5, y: src.position.y - 0.5 },
          ].find((q) => isItemInBounds(p, src.levelId, q)) ?? shift(src.position);
        p.items.push({ ...clone(src), id: nid, position: spot });
        break;
      }
      case 'roof': {
        const src = p.roofs.find((r) => r.id === id);
        if (!src) continue;
        p.roofs.push({ ...clone(src), id: nid, polygon: src.polygon.map(shift) });
        break;
      }
    }
    created.push(nid);
  }
  return created;
}
