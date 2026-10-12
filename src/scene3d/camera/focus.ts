import type { Project, Selection } from '../../model/types';
import { polygonBounds } from '../../geometry/polygon';
import type { Vec3 } from './views';

export interface FocusTarget {
  center: Vec3;
  /** Rough size of the thing (m) — how far to stand back. */
  radius: number;
}

/** World-space centre and size of the selected entities (F key / double-click), or null when nothing is selected. */
export function focusTarget(project: Project, selection: Selection): FocusTarget | null {
  if (!selection.type || !selection.ids.length) return null;
  const pts: { x: number; y: number; z: number }[] = [];
  const elev = (levelId: string) => project.levels.find((l) => l.id === levelId)?.elevation ?? 0;
  const ftc = (levelId: string) =>
    project.levels.find((l) => l.id === levelId)?.floorToCeiling ?? 2.8;
  for (const id of selection.ids) {
    switch (selection.type) {
      case 'wall': {
        const w = project.walls.find((x) => x.id === id);
        if (!w) break;
        const e = elev(w.levelId);
        const h = ftc(w.levelId) / 2;
        pts.push({ x: w.start.x, y: e + h, z: w.start.y }, { x: w.end.x, y: e + h, z: w.end.y });
        break;
      }
      case 'opening': {
        const o = project.openings.find((x) => x.id === id);
        const w = o && project.walls.find((x) => x.id === o.wallId);
        if (!o || !w) break;
        const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
        const t = o.offset / len;
        pts.push({
          x: w.start.x + (w.end.x - w.start.x) * t,
          y: elev(w.levelId) + o.sillHeight + o.height / 2,
          z: w.start.y + (w.end.y - w.start.y) * t,
        });
        break;
      }
      case 'room': {
        const r = project.rooms.find((x) => x.id === id);
        if (!r) break;
        const b = polygonBounds(r.polygon);
        const e = elev(r.levelId);
        pts.push({ x: b.min.x, y: e + 1, z: b.min.y }, { x: b.max.x, y: e + 1, z: b.max.y });
        break;
      }
      case 'item': {
        const i = project.items.find((x) => x.id === id);
        if (i)
          pts.push({
            x: i.position.x,
            y: elev(i.levelId) + (i.elevation ?? 0) + 0.5,
            z: i.position.y,
          });
        break;
      }
      case 'column': {
        const c = project.columns.find((x) => x.id === id);
        if (c)
          pts.push({ x: c.position.x, y: elev(c.levelId) + ftc(c.levelId) / 2, z: c.position.y });
        break;
      }
      case 'stair': {
        const s = project.stairs.find((x) => x.id === id);
        if (s) pts.push({ x: s.position.x, y: elev(s.fromLevelId) + 1.5, z: s.position.y });
        break;
      }
      case 'roof': {
        const r = project.roofs.find((x) => x.id === id);
        if (!r) break;
        const b = polygonBounds(r.polygon);
        const e = elev(r.levelId) + ftc(r.levelId);
        pts.push({ x: b.min.x, y: e, z: b.min.y }, { x: b.max.x, y: e, z: b.max.y });
        break;
      }
    }
  }
  if (!pts.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  const size = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z);
  return {
    center: [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2],
    radius: Math.max(size / 2, 0.8),
  };
}

/** Camera pose looking at a focus target from the current viewing direction. */
export function poseForFocus(focus: FocusTarget, from: Vec3): { position: Vec3; target: Vec3 } {
  const dir = [from[0] - focus.center[0], from[1] - focus.center[1], from[2] - focus.center[2]];
  const len = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1;
  const d = Math.max(focus.radius * 2.6, 2.5);
  return {
    target: focus.center,
    position: [
      focus.center[0] + (dir[0]! / len) * d,
      focus.center[1] + (dir[1]! / len) * d,
      focus.center[2] + (dir[2]! / len) * d,
    ],
  };
}
