import { polygonArea } from '../geometry/polygon';
import type { Project, Room } from '../model/types';
import { slabVoids } from '../scene3d/generators/voids';
import { unionPolygons } from '../scene3d/generators/common';
import polygonClipping from 'polygon-clipping';

/** A room that is (almost) entirely a hole in the floor — the open space above a double-height room. */
export function isVoidRoom(project: Project, room: Room): boolean {
  const level = project.levels.find((l) => l.id === room.levelId);
  if (!level) return false;
  const voids = slabVoids(project, level);
  if (!voids.length) return false;
  const v = unionPolygons(voids);
  const inter = polygonClipping.intersection(
    [room.polygon.map((p) => [p.x, p.y] as [number, number])],
    v,
  );
  const area = inter.reduce(
    (s, poly) => s + Math.abs(polygonArea(poly[0]!.map(([x, y]) => ({ x, y })))),
    0,
  );
  return area / Math.max(polygonArea(room.polygon), 1e-6) > 0.9;
}
