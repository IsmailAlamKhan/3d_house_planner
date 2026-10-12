import { polygonArea, polygonBounds } from '../../geometry/polygon';
import { projectOnSegment } from '../../geometry/vec';
import { t } from '../../i18n';
import * as ops from '../../model/ops';
import { ModelError } from '../../model/ops';
import type { Point, Project, Room, Wall } from '../../model/types';
import type { Side } from '../schemas';
import { EditError } from './lookup';

const ON = 1e-3;

export interface RoomBox {
  min: Point;
  max: Point;
  /** True when the room is (nearly) an axis-aligned rectangle. */
  rectangular: boolean;
}

export function roomBox(room: Room): RoomBox {
  const b = polygonBounds(room.polygon);
  const rect = (b.max.x - b.min.x) * (b.max.y - b.min.y);
  return {
    min: b.min,
    max: b.max,
    rectangular: Math.abs(polygonArea(room.polygon) - rect) < 0.02 * rect,
  };
}

export const axisOf = (side: Side): 'x' | 'y' => (side === 'east' || side === 'west' ? 'x' : 'y');
/** Unit direction pointing OUT of a room through the given side (plan: north = −y). */
export const outward = (side: Side): Point =>
  side === 'north'
    ? { x: 0, y: -1 }
    : side === 'south'
      ? { x: 0, y: 1 }
      : side === 'east'
        ? { x: 1, y: 0 }
        : { x: -1, y: 0 };
export const oppositeSide = (s: Side): Side =>
  s === 'north' ? 'south' : s === 'south' ? 'north' : s === 'east' ? 'west' : 'east';

const isHorizontal = (w: Wall) => Math.abs(w.start.y - w.end.y) < ON;
const isVertical = (w: Wall) => Math.abs(w.start.x - w.end.x) < ON;

/** The wall running along one side of a (rectangular) room — the one covering most of that side. */
export function wallOnSide(project: Project, room: Room, side: Side): Wall | undefined {
  const box = roomBox(room);
  const line =
    side === 'north'
      ? box.min.y
      : side === 'south'
        ? box.max.y
        : side === 'west'
          ? box.min.x
          : box.max.x;
  const lo = axisOf(side) === 'y' ? box.min.x : box.min.y;
  const hi = axisOf(side) === 'y' ? box.max.x : box.max.y;
  let best: { wall: Wall; overlap: number } | undefined;
  for (const w of project.walls) {
    if (w.levelId !== room.levelId) continue;
    const ok =
      axisOf(side) === 'y'
        ? isHorizontal(w) && Math.abs(w.start.y - line) < ON
        : isVertical(w) && Math.abs(w.start.x - line) < ON;
    if (!ok) continue;
    const a = axisOf(side) === 'y' ? Math.min(w.start.x, w.end.x) : Math.min(w.start.y, w.end.y);
    const b = axisOf(side) === 'y' ? Math.max(w.start.x, w.end.x) : Math.max(w.start.y, w.end.y);
    const overlap = Math.min(b, hi) - Math.max(a, lo);
    if (overlap > 0.2 && (!best || overlap > best.overlap)) best = { wall: w, overlap };
  }
  return best?.wall;
}

const onShellBoundary = (project: Project, w: Wall): boolean => {
  const fp = project.shell.footprint;
  return (
    w.type === 'exterior' ||
    fp.some(
      (a, i) =>
        projectOnSegment(w.start, a, fp[(i + 1) % fp.length]!).distance < ON &&
        projectOnSegment(w.end, a, fp[(i + 1) % fp.length]!).distance < ON,
    )
  );
};

/** The wall plus the walls continuing it in a straight line, end to end. */
function straightChain(p: Project, wall: Wall): Wall[] {
  const horizontal = isHorizontal(wall);
  const same = (w: Wall) =>
    w.levelId === wall.levelId &&
    (horizontal
      ? isHorizontal(w) && Math.abs(w.start.y - wall.start.y) < ON
      : isVertical(w) && Math.abs(w.start.x - wall.start.x) < ON);
  const span = (w: Wall): [number, number] =>
    horizontal
      ? [Math.min(w.start.x, w.end.x), Math.max(w.start.x, w.end.x)]
      : [Math.min(w.start.y, w.end.y), Math.max(w.start.y, w.end.y)];
  const chain = [wall];
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of p.walls) {
      if (chain.includes(w) || !same(w)) continue;
      const [a, b] = span(w);
      if (
        chain.some((c) => {
          const [ca, cb] = span(c);
          return a <= cb + ON && b >= ca - ON;
        })
      ) {
        chain.push(w);
        grew = true;
      }
    }
  }
  return chain;
}

/**
 * Pushes a straight wall (and any wall continuing it) sideways by (dx, dy). Walls that end on it follow, so
 * every room stays closed. Throws an EditError with a plain explanation when that is not possible.
 */
export function moveWallLine(
  p: Project,
  wall: Wall,
  dx: number,
  dy: number,
  roomName: string,
  sideName: string,
): void {
  if (!isHorizontal(wall) && !isVertical(wall))
    throw new EditError(
      t('ai.edit.noWall').replace('{side}', sideName).replace('{room}', roomName),
    );
  const chain = straightChain(p, wall);
  if (chain.some((w) => onShellBoundary(p, w)))
    throw new EditError(
      t('ai.edit.outerWall').replace('{side}', sideName).replace('{room}', roomName),
    );
  const moved = new Map<string, { id: string; start: Point; end: Point }>();
  for (const w of chain)
    moved.set(w.id, {
      id: w.id,
      start: { x: w.start.x + dx, y: w.start.y + dy },
      end: { x: w.end.x + dx, y: w.end.y + dy },
    });
  for (const other of p.walls) {
    if (other.levelId !== wall.levelId || moved.has(other.id)) continue;
    const follow = (pt: Point) =>
      chain.some((c) => projectOnSegment(pt, c.start, c.end).distance < ON);
    const s = follow(other.start);
    const e = follow(other.end);
    if (s || e) {
      moved.set(other.id, {
        id: other.id,
        start: s ? { x: other.start.x + dx, y: other.start.y + dy } : other.start,
        end: e ? { x: other.end.x + dx, y: other.end.y + dy } : other.end,
      });
    }
  }
  try {
    ops.setWallGeometry(p, [...moved.values()]);
  } catch (e) {
    if (e instanceof ModelError)
      throw new EditError(t('ai.edit.wouldBreak').replace('{why}', e.message));
    throw e;
  }
  // No room may collapse.
  for (const r of p.rooms.filter((x) => x.levelId === wall.levelId)) {
    const b = roomBox(r);
    const min = Math.min(b.max.x - b.min.x, b.max.y - b.min.y);
    if (min < 1.0)
      throw new EditError(t('ai.edit.tooSmall').replace('{room}', r.name).replace('{min}', '1.0'));
  }
  // …and everything must stay inside the apartment.
  const bounds = polygonBounds(p.shell.footprint);
  for (const w of moved.keys()) {
    const m = p.walls.find((x) => x.id === w)!;
    for (const pt of [m.start, m.end]) {
      if (
        pt.x < bounds.min.x - ON ||
        pt.x > bounds.max.x + ON ||
        pt.y < bounds.min.y - ON ||
        pt.y > bounds.max.y + ON
      ) {
        throw new EditError(t('ai.edit.wouldBreak').replace('{why}', t('msg.outside')));
      }
    }
  }
}
