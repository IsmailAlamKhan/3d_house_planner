import { current, isDraft } from 'immer';
import { nanoid } from 'nanoid';
import type { Item, Level, Opening, Project, Room, Stair, Wall } from '../types';

/** Thrown when an operation would break a model integrity rule. The store discards the whole edit. */
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export const newId = (): string => nanoid(10);

function must<T>(value: T | undefined, what: string, id: string): T {
  if (value === undefined) throw new ModelError(`${what} not found: ${id}`);
  return value;
}

export const getLevel = (p: Project, id: string): Level =>
  must(
    p.levels.find((l) => l.id === id),
    'Level',
    id,
  );
export const getWall = (p: Project, id: string): Wall =>
  must(
    p.walls.find((w) => w.id === id),
    'Wall',
    id,
  );
export const getOpening = (p: Project, id: string): Opening =>
  must(
    p.openings.find((o) => o.id === id),
    'Opening',
    id,
  );
export const getRoom = (p: Project, id: string): Room =>
  must(
    p.rooms.find((r) => r.id === id),
    'Room',
    id,
  );
export const getStair = (p: Project, id: string): Stair =>
  must(
    p.stairs.find((s) => s.id === id),
    'Stair',
    id,
  );
export const getItem = (p: Project, id: string): Item =>
  must(
    p.items.find((i) => i.id === id),
    'Item',
    id,
  );

/** Deep-clones a (possibly immer-draft) entity into plain data. */
export const clone = <T extends object>(draft: T): T =>
  JSON.parse(JSON.stringify(isDraft(draft) ? current(draft as never) : draft)) as T;
