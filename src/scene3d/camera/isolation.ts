import { pointInPolygon } from '../../geometry/polygon';
import { wallsAroundRoom } from '../../model/ops';
import type { Project } from '../../model/types';
import type { AnyPart } from '../generators/common';

export type Isolation =
  { kind: 'none' } | { kind: 'level'; levelId: string } | { kind: 'room'; roomId: string };

export const NO_ISOLATION: Isolation = { kind: 'none' };

/** Which parts stay solid when a single room is isolated (everything else is drawn as a faint ghost). */
export interface RoomFocus {
  roomId: string;
  levelId: string;
  walls: Set<string>;
  openings: Set<string>;
  isSolid: (part: AnyPart, levelId: string) => boolean;
}

export function roomFocus(project: Project, roomId: string): RoomFocus | null {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const walls = new Set(wallsAroundRoom(project, room).map((w) => w.id));
  const openings = new Set(project.openings.filter((o) => walls.has(o.wallId)).map((o) => o.id));
  const items = new Set(
    project.items
      .filter((i) => i.levelId === room.levelId && pointInPolygon(i.position, room.polygon, 0.05))
      .map((i) => i.id),
  );
  return {
    roomId,
    levelId: room.levelId,
    walls,
    openings,
    isSolid: (part, levelId) => {
      if (levelId !== room.levelId || !part.entity) return false;
      switch (part.entity.type) {
        case 'room':
          return part.entity.id === roomId;
        case 'wall':
          return walls.has(part.entity.id);
        case 'opening':
          return openings.has(part.entity.id);
        case 'item':
          return items.has(part.entity.id);
        default:
          return false;
      }
    },
  };
}

/** Levels to draw for an isolation (null = all of them, subject to the usual level filter). */
export function isolatedLevelId(iso: Isolation): string | null {
  return iso.kind === 'level' ? iso.levelId : null;
}
