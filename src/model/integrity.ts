import { dist } from '../geometry/vec';
import { pointInPolygon } from '../geometry/polygon';
import type { Opening, Point, Project, Wall } from './types';

/** Smallest wall we allow (m). Anything shorter is treated as zero-length. */
export const MIN_WALL_LENGTH = 0.05;
/** Clear distance an opening must keep from either wall end (m). */
export const OPENING_END_MARGIN = 0.05;
/** How far outside the shell footprint an item center may sit (m), to allow wall-hugging. */
export const ITEM_BOUNDS_TOLERANCE = 0.05;

export const wallLength = (w: Pick<Wall, 'start' | 'end'>): number => dist(w.start, w.end);

export const isWallLengthValid = (start: Point, end: Point): boolean =>
  dist(start, end) >= MIN_WALL_LENGTH;

export function openingFitsWall(wallLen: number, offset: number, width: number): boolean {
  const half = width / 2;
  return (
    offset - half >= OPENING_END_MARGIN - 1e-9 &&
    offset + half <= wallLen - OPENING_END_MARGIN + 1e-9
  );
}

type Span = Pick<Opening, 'offset' | 'width'>;

export const openingsOverlap = (a: Span, b: Span): boolean =>
  Math.abs(a.offset - b.offset) < (a.width + b.width) / 2 - 1e-9;

/** Returns the first opening on `wallId` that overlaps `candidate` (ignoring `candidate.id`), if any. */
export function findOverlappingOpening(
  openings: Opening[],
  wallId: string,
  candidate: Span & { id?: string },
): Opening | undefined {
  return openings.find(
    (o) => o.wallId === wallId && o.id !== candidate.id && openingsOverlap(o, candidate),
  );
}

/** An item belongs to an existing level and its center lies within the shell footprint. */
export function isItemInBounds(project: Project, levelId: string, position: Point): boolean {
  if (!project.levels.some((l) => l.id === levelId)) return false;
  return pointInPolygon(position, itemArea(project), ITEM_BOUNDS_TOLERANCE);
}

/** Where items may stand: the shell (apartment) or the whole plot (villa with a plot drawn). */
export function itemArea(project: Project): Point[] {
  return project.kind === 'villa' && project.site.plot.length >= 3
    ? project.site.plot
    : project.shell.footprint;
}

export function wallHeight(project: Project, wall: Wall): number {
  const level = project.levels.find((l) => l.id === wall.levelId);
  return wall.height ?? level?.floorToCeiling ?? 2.7;
}

/** Which side of the wall is "inside": +1 = left (+z) is inside. Exterior walls face away from the shell. */
export function insideSign(wall: Wall, footprint: Point[]): 1 | -1 {
  if (wall.type !== 'exterior') return 1;
  const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  const len = dist(wall.start, wall.end);
  const nx = -(wall.end.y - wall.start.y) / len;
  const ny = (wall.end.x - wall.start.x) / len;
  const probe = Math.max(0.2, wall.thickness);
  return pointInPolygon({ x: mid.x + nx * probe, y: mid.y + ny * probe }, footprint) ? 1 : -1;
}
