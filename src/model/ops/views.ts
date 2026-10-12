import type { Project, SavedView } from '../types';
import { ModelError, newId } from './common';

export type NewView = Omit<SavedView, 'id'>;

/** Stores a camera position under a name. Names are unique (a repeated name gets " 2", " 3", …). */
export function addView(p: Project, input: NewView): string {
  const base = input.name.trim();
  if (!base) throw new ModelError('A saved view needs a name', 'err.viewName');
  let name = base;
  for (let n = 2; p.views.some((v) => v.name === name); n++) name = `${base} ${n}`;
  const id = newId();
  p.views.push({ ...input, name, id });
  return id;
}

export function renameView(p: Project, id: string, name: string): void {
  const v = p.views.find((x) => x.id === id);
  if (!v) throw new ModelError(`View not found: ${id}`);
  const trimmed = name.trim();
  if (!trimmed) throw new ModelError('A saved view needs a name', 'err.viewName');
  v.name = trimmed;
}

export function deleteView(p: Project, id: string): void {
  p.views = p.views.filter((v) => v.id !== id);
}
