import { polygonArea } from '../geometry/polygon';
import { projectOnSegment } from '../geometry/vec';
import { wallsAroundRoom } from '../model/ops';
import type { Project, Room, RoomType } from '../model/types';
import { slabVoids } from '../scene3d/generators/voids';
import { isVoidRoom } from './voidRoom';

export interface LevelAreas {
  levelId: string;
  name: string;
  /** Outline of the shell (centre lines of the outer walls). */
  gross: number;
  /** Sum of room areas measured between wall surfaces. */
  usable: number;
  /** Everything else: wall thickness, columns, … (gross − usable − open void). */
  walls: number;
  /** Floor opening (stairwell and double-height voids) — counted in the level below, not here. */
  openVoid: number;
  rooms: { id: string; name: string; type: RoomType; area: number }[];
}

export interface AreaSchedule {
  levels: LevelAreas[];
  total: { gross: number; usable: number; walls: number };
  /** Usable area by room type across the whole home. */
  byType: Partial<Record<RoomType, number>>;
  /** Share of usable area that is circulation (stair hall, corridors). */
  circulationShare: number;
}

/** Clear floor area of a room: the centre-line polygon minus half the thickness of each bounding wall. */
export function clearArea(project: Project, room: Room): number {
  const poly = room.polygon;
  let strip = 0;
  const walls = wallsAroundRoom(project, room);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const wall = walls.find(
      (w) =>
        projectOnSegment(a, w.start, w.end).distance < 1e-3 &&
        projectOnSegment(b, w.start, w.end).distance < 1e-3,
    );
    strip += len * ((wall?.thickness ?? 0.15) / 2);
  }
  // Each convex corner is covered twice by the strips; add the small squares back.
  const t = 0.1;
  return Math.max(0, polygonArea(poly) - strip + poly.length * t * t * 0.25);
}

/** Per-level and total areas, with usable area vs wall area. */
export function areaSchedule(project: Project): AreaSchedule {
  const gross = polygonArea(project.shell.footprint);
  const levels: LevelAreas[] = [...project.levels]
    .sort((a, b) => a.index - b.index)
    .map((level) => {
      const rooms = project.rooms
        .filter((r) => r.levelId === level.id && !isVoidRoom(project, r))
        .map((r) => ({ id: r.id, name: r.name, type: r.type, area: clearArea(project, r) }));
      const usable = rooms.reduce((s, r) => s + r.area, 0);
      const voids = slabVoids(project, level).reduce((s, v) => s + polygonArea(v), 0);
      return {
        levelId: level.id,
        name: level.name,
        gross,
        usable,
        walls: Math.max(0, gross - usable - voids),
        openVoid: voids,
        rooms,
      };
    });
  const byType: AreaSchedule['byType'] = {};
  for (const l of levels) for (const r of l.rooms) byType[r.type] = (byType[r.type] ?? 0) + r.area;
  const usable = levels.reduce((s, l) => s + l.usable, 0);
  const circulation = (byType.stair ?? 0) + (byType.corridor ?? 0);
  return {
    levels,
    total: { gross: gross * levels.length, usable, walls: levels.reduce((s, l) => s + l.walls, 0) },
    byType,
    circulationShare: usable > 0 ? circulation / usable : 0,
  };
}
