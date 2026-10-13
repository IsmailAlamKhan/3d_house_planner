import type { Design, OptionMeta, Project } from '../types';
import { ModelError, newId } from './common';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const plain = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

/** The design fields of a project as a standalone, deep copy. */
export function designOf(p: Project): Design {
  // A JSON round-trip copies draft (immer) values too, which structuredClone cannot.
  return plain({
    levels: p.levels,
    walls: p.walls,
    openings: p.openings,
    rooms: p.rooms,
    stairs: p.stairs,
    items: p.items,
    columns: p.columns,
    roofs: p.roofs,
    materials: p.materials,
    zones: p.site.zones,
    gates: p.site.gates,
  }) as Design;
}

/** A project showing `design` (everything else — shell, settings, costs, notes — is the project's own). */
export function withDesign(p: Project, design: Design): Project {
  const c = plain(design) as Design;
  const { zones, gates, ...rest } = c;
  return {
    ...p,
    ...rest,
    site: { ...p.site, zones: zones ?? p.site.zones, gates: gates ?? p.site.gates },
  };
}

function loadDesign(p: Project, d: Design): void {
  const c = plain(d) as Design;
  p.levels = c.levels;
  p.walls = c.walls;
  p.openings = c.openings;
  p.rooms = c.rooms;
  p.stairs = c.stairs;
  p.items = c.items;
  p.columns = c.columns;
  p.roofs = c.roofs;
  p.materials = c.materials;
  if (c.zones) p.site.zones = c.zones;
  if (c.gates) p.site.gates = c.gates;
}

const letterOrder = (m: OptionMeta) => (m.letter === null ? -1 : LETTERS.indexOf(m.letter));

/** Every design of the project, the showing one included, in display order (Main first, then A, B, C …). */
export function allDesigns(p: Project): (OptionMeta & { current: boolean })[] {
  return [
    { ...p.currentOption, current: true },
    ...p.options.map((o) => ({ id: o.id, letter: o.letter, name: o.name, current: false })),
  ].sort((a, b) => letterOrder(a) - letterOrder(b));
}

/** The next free letter: A, B, C … (Main has none). */
export function nextOptionLetter(p: Project): string {
  const used = new Set(allDesigns(p).map((d) => d.letter));
  const free = [...LETTERS].find((l) => !used.has(l));
  if (!free) throw new ModelError('There are already 26 design options', 'err.optionsMax');
  return free;
}

/**
 * Saves a copy of the design being edited as a new option ("Option A", …) and switches to the copy, so the original
 * is kept untouched on the side. One undo step.
 */
export function duplicateDesign(p: Project): string {
  const letter = nextOptionLetter(p);
  p.options.push({ ...p.currentOption, design: designOf(p) });
  const id = newId();
  p.currentOption = { id, letter, name: null };
  return id;
}

/** Shows another design: the one being edited is put aside as it is, the chosen one is loaded. */
export function switchDesign(p: Project, id: string): void {
  if (p.currentOption.id === id) return;
  const target = p.options.find((o) => o.id === id);
  if (!target) throw new ModelError(`Design option not found: ${id}`);
  const aside = { ...p.currentOption, design: designOf(p) };
  p.options = p.options.filter((o) => o.id !== id);
  p.options.push(aside);
  loadDesign(p, target.design);
  p.currentOption = { id: target.id, letter: target.letter, name: target.name };
}

export function renameDesign(p: Project, id: string, name: string): void {
  const trimmed = name.trim();
  const value = trimmed || null;
  if (p.currentOption.id === id) p.currentOption.name = value;
  else {
    const o = p.options.find((x) => x.id === id);
    if (!o) throw new ModelError(`Design option not found: ${id}`);
    o.name = value;
  }
}

/** Removes a design that is not showing. The one being edited cannot be deleted. */
export function deleteDesign(p: Project, id: string): void {
  if (p.currentOption.id === id)
    throw new ModelError(
      'Switch to another design before deleting this one',
      'err.optionSwitchFirst',
    );
  p.options = p.options.filter((o) => o.id !== id);
}

/** A design of the project as a full project (for comparing). */
export function projectForDesign(p: Project, id: string): Project | null {
  if (p.currentOption.id === id) return p;
  const o = p.options.find((x) => x.id === id);
  return o ? withDesign(p, o.design) : null;
}
