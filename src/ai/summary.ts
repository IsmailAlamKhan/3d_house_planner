import { getEntry } from '../catalog';
import { polygonArea, polygonBounds, pointInPolygon } from '../geometry/polygon';
import type { Project, Selection } from '../model/types';

/** A short plain-text description of the project for the language model — never the full JSON. */
export function summarizeProject(
  project: Project,
  selection: Selection,
  activeLevelId: string,
): string {
  const b = polygonBounds(project.shell.footprint);
  const lines: string[] = [];
  lines.push(
    `Apartment shell: ${(b.max.x - b.min.x).toFixed(1)} m (east-west) × ${(b.max.y - b.min.y).toFixed(1)} m (north-south). North is the top of the plan, east is right.`,
  );
  for (const level of [...project.levels].sort((a, c) => a.index - c.index)) {
    lines.push(`${level.name}${level.id === activeLevelId ? ' (currently open)' : ''}:`);
    for (const r of project.rooms.filter((x) => x.levelId === level.id)) {
      const rb = polygonBounds(r.polygon);
      const items = project.items
        .filter((i) => i.levelId === level.id && pointInPolygon(i.position, r.polygon))
        .map((i) => getEntry(i.catalogId)?.catalogId ?? i.catalogId);
      const counts = new Map<string, number>();
      for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
      const furniture = [...counts.entries()]
        .map(([id, n]) => (n > 1 ? `${id}×${n}` : id))
        .join(', ');
      lines.push(
        `- ${r.name} (${r.type}) ${(rb.max.x - rb.min.x).toFixed(1)}×${(rb.max.y - rb.min.y).toFixed(1)} m, ${polygonArea(r.polygon).toFixed(1)} m², floor ${r.floorMaterial}${furniture ? `, contains: ${furniture}` : ''}`,
      );
    }
  }
  if (project.stairs[0]) lines.push(`Stair: ${project.stairs[0].type}.`);
  if (selection.type && selection.ids.length) {
    const names = selection.ids
      .map((id) =>
        selection.type === 'room'
          ? project.rooms.find((r) => r.id === id)?.name
          : selection.type === 'item'
            ? project.items.find((i) => i.id === id)?.catalogId
            : selection.type === 'wall'
              ? 'a wall'
              : selection.type,
      )
      .filter(Boolean);
    lines.push(`The user has selected: ${selection.type} ${names.join(', ')}.`);
  }
  return lines.join('\n');
}
