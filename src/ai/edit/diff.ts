import { fmtNum, t } from '../../i18n';
import { polygonArea } from '../../geometry/polygon';
import { entryName, getEntry } from '../../catalog';
import { materialName } from '../../materials/eyedropper';
import { roomOnSide } from '../../model/ops';
import type { Project, Wall } from '../../model/types';
import { formatArea } from '../../ui/units';

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Name of a wall for humans: the rooms on either side, or "the outer wall of X". */
function wallLabel(p: Project, w: Wall): string {
  const left = roomOnSide(p, w, 'left')?.name;
  const right = roomOnSide(p, w, 'right')?.name;
  if (left && right && left !== right)
    return t('ai.diff.wallBetween').replace('{a}', left).replace('{b}', right);
  const one = left ?? right;
  return one ? t('ai.diff.wallOf').replace('{room}', one) : t('ai.diff.aWall');
}

const itemName = (id: string) => {
  const e = getEntry(id);
  return e ? entryName(e).toLowerCase() : id;
};

/** Plain-language list of what differs between two versions of a project. */
export function describeChanges(before: Project, after: Project): string[] {
  const out: string[] = [];
  const u = before.units;

  // Rooms
  for (const r of after.rooms) {
    const old = before.rooms.find((x) => x.id === r.id);
    if (!old) {
      out.push(
        t('ai.diff.newRoom')
          .replace('{room}', r.name)
          .replace('{area}', formatArea(polygonArea(r.polygon), u)),
      );
      continue;
    }
    const a0 = polygonArea(old.polygon);
    const a1 = polygonArea(r.polygon);
    if (!same(a0, a1))
      out.push(
        t('ai.diff.resized')
          .replace('{room}', r.name)
          .replace('{from}', formatArea(a0, u))
          .replace('{to}', formatArea(a1, u)),
      );
    if (old.name !== r.name)
      out.push(t('ai.diff.renamed').replace('{from}', old.name).replace('{to}', r.name));
    else if (old.type !== r.type)
      out.push(t('ai.diff.retyped').replace('{room}', r.name).replace('{type}', r.type));
    if (old.floorMaterial !== r.floorMaterial)
      out.push(
        t('ai.diff.floor')
          .replace('{room}', r.name)
          .replace('{from}', materialName(old.floorMaterial))
          .replace('{to}', materialName(r.floorMaterial)),
      );
    if (old.ceilingMaterial !== r.ceilingMaterial)
      out.push(
        t('ai.diff.ceiling')
          .replace('{room}', r.name)
          .replace('{to}', materialName(r.ceilingMaterial)),
      );
  }
  for (const old of before.rooms)
    if (!after.rooms.some((x) => x.id === old.id))
      out.push(t('ai.diff.removedRoom').replace('{room}', old.name));

  // Walls
  const moved: string[] = [];
  let paintedFaces = 0;
  for (const w of after.walls) {
    const old = before.walls.find((x) => x.id === w.id);
    if (!old) continue;
    const dx = (w.start.x + w.end.x) / 2 - (old.start.x + old.end.x) / 2;
    const dy = (w.start.y + w.end.y) / 2 - (old.start.y + old.end.y) / 2;
    const shift = Math.hypot(dx, dy);
    if (shift > 0.005)
      moved.push(
        t('ai.diff.movedWall')
          .replace('{wall}', wallLabel(after, w))
          .replace('{d}', `${fmtNum(shift, 1)} ${t('unit.m')}`),
      );
    if (old.materialInside !== w.materialInside || old.materialOutside !== w.materialOutside)
      paintedFaces++;
  }
  out.push(...moved.slice(0, 4));
  if (moved.length > 4) out.push(t('ai.diff.moreWalls').replace('{n}', String(moved.length - 4)));
  if (paintedFaces) out.push(t('ai.diff.painted').replace('{n}', String(paintedFaces)));
  const newWalls = after.walls.filter((w) => !before.walls.some((x) => x.id === w.id)).length;
  const goneWalls = before.walls.filter((w) => !after.walls.some((x) => x.id === w.id)).length;
  if (newWalls) out.push(t('ai.diff.newWalls').replace('{n}', String(newWalls)));
  if (goneWalls) out.push(t('ai.diff.goneWalls').replace('{n}', String(goneWalls)));

  // Doors & windows
  const addedOpen = after.openings.filter((o) => !before.openings.some((x) => x.id === o.id));
  const goneOpen = before.openings.filter((o) => !after.openings.some((x) => x.id === o.id));
  if (addedOpen.length)
    out.push(
      t('ai.diff.addedOpenings')
        .replace('{n}', String(addedOpen.length))
        .replace('{what}', [...new Set(addedOpen.map((o) => o.kind))].join('/')),
    );
  if (goneOpen.length) out.push(t('ai.diff.goneOpenings').replace('{n}', String(goneOpen.length)));

  // Furniture
  const count = (p: Project) =>
    p.items.reduce(
      (m, i) => m.set(i.catalogId, (m.get(i.catalogId) ?? 0) + 1),
      new Map<string, number>(),
    );
  const b = count(before);
  const a = count(after);
  for (const [id, n] of a)
    if (n > (b.get(id) ?? 0))
      out.push(
        t('ai.diff.addedItem')
          .replace('{n}', String(n - (b.get(id) ?? 0)))
          .replace('{item}', itemName(id)),
      );
  for (const [id, n] of b)
    if (n > (a.get(id) ?? 0))
      out.push(
        t('ai.diff.removedItem')
          .replace('{n}', String(n - (a.get(id) ?? 0)))
          .replace('{item}', itemName(id)),
      );
  const movedItems = after.items.filter((i) => {
    const old = before.items.find((x) => x.id === i.id);
    return (
      old &&
      (Math.hypot(old.position.x - i.position.x, old.position.y - i.position.y) > 0.005 ||
        Math.abs(old.rotation - i.rotation) > 0.005)
    );
  });
  for (const i of movedItems.slice(0, 3))
    out.push(t('ai.diff.movedItem').replace('{item}', itemName(i.catalogId)));

  // Stair
  for (const s of after.stairs) {
    const old = before.stairs.find((x) => x.id === s.id);
    if (old && old.type !== s.type)
      out.push(t('ai.diff.stair').replace('{from}', old.type).replace('{to}', s.type));
  }
  return out;
}
