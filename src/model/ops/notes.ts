import { labelPoint } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import type { Note, Project } from '../types';
import { ModelError, newId } from './common';

export interface NewNote {
  text?: string;
  levelId: string;
  position: Vec2;
  entity?: Note['entity'];
}

export function addNote(p: Project, input: NewNote): string {
  if (!p.levels.some((l) => l.id === input.levelId)) throw new ModelError('Level not found');
  const id = newId();
  p.notes.push({
    id,
    text: input.text ?? '',
    resolved: false,
    createdAt: new Date().toISOString(),
    levelId: input.levelId,
    position: input.position,
    entity: input.entity,
  });
  return id;
}

const find = (p: Project, id: string): Note => {
  const n = p.notes.find((x) => x.id === id);
  if (!n) throw new ModelError(`Note not found: ${id}`);
  return n;
};

export function updateNoteText(p: Project, id: string, text: string): void {
  find(p, id).text = text;
}

export function setNoteResolved(p: Project, id: string, resolved: boolean): void {
  find(p, id).resolved = resolved;
}

export function deleteNote(p: Project, id: string): void {
  p.notes = p.notes.filter((n) => n.id !== id);
}

/** Where a note's pin is drawn now: on the thing it is attached to (it follows it), else where it was dropped. */
export function notePin(project: Project, note: Note): { levelId: string; position: Vec2 } {
  const e = note.entity;
  const fallback = { levelId: note.levelId, position: note.position };
  if (!e) return fallback;
  switch (e.type) {
    case 'item': {
      const i = project.items.find((x) => x.id === e.id);
      return i ? { levelId: i.levelId, position: i.position } : fallback;
    }
    case 'room': {
      const r = project.rooms.find((x) => x.id === e.id);
      return r ? { levelId: r.levelId, position: labelPoint(r.polygon) } : fallback;
    }
    case 'wall': {
      const w = project.walls.find((x) => x.id === e.id);
      return w
        ? {
            levelId: w.levelId,
            position: { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 },
          }
        : fallback;
    }
    case 'opening': {
      const o = project.openings.find((x) => x.id === e.id);
      const w = o && project.walls.find((x) => x.id === o.wallId);
      if (!o || !w) return fallback;
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
      const t = o.offset / len;
      return {
        levelId: w.levelId,
        position: {
          x: w.start.x + (w.end.x - w.start.x) * t,
          y: w.start.y + (w.end.y - w.start.y) * t,
        },
      };
    }
    case 'stair': {
      const s = project.stairs.find((x) => x.id === e.id);
      return s ? { levelId: s.fromLevelId, position: s.position } : fallback;
    }
    case 'column': {
      const c = project.columns.find((x) => x.id === e.id);
      return c ? { levelId: c.levelId, position: c.position } : fallback;
    }
    case 'roof': {
      const r = project.roofs.find((x) => x.id === e.id);
      return r ? { levelId: r.levelId, position: labelPoint(r.polygon) } : fallback;
    }
  }
}
