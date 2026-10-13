import { boxCorners, overlapDepth, wallRect } from '../geometry/collide';
import { pointInPolygon } from '../geometry/polygon';
import { type Vec2, projectOnSegment } from '../geometry/vec';
import { type TranslationKey, t, tf } from '../i18n';
import {
  ITEM_BOUNDS_TOLERANCE,
  OPENING_END_MARGIN,
  itemArea,
  openingsOverlap,
  wallHeight,
  wallLength,
} from '../model/integrity';
import type { Item, Project, Wall } from '../model/types';
import { formatLength } from '../ui/units';
import { type CatalogEntry, type Size } from './types';
import { getEntry, itemSize } from './index';

export type Placed<T> = ({ ok: true } & T) | { ok: false; message: string };

const ROT_STEP = Math.PI / 12; // 15°
const WALL_SNAP_GAP = 0.4; // how close (beyond contact) an item must be to snap to a wall
const WALL_GRID = 0.05;
/** An opening that must be nudged further than this fraction of its width is refused instead. */
const MAX_NUDGE = 1;

export const snapAngle = (a: number, step = ROT_STEP): number => Math.round(a / step) * step;

export const normalizeAngle = (a: number): number => {
  const tau = Math.PI * 2;
  return ((a % tau) + tau) % tau;
};

const name = (e: CatalogEntry): string => t(e.nameKey as TranslationKey).toLowerCase();

// ───────────────────────── Doors & windows ─────────────────────────

export interface WallPlacement {
  wallId: string;
  /** Distance along the wall from `start` to the opening centre. */
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  /** Clear distance from the opening's edges to the wall's two ends (for on-screen dimensions). */
  distStart: number;
  distEnd: number;
  /** True when the opening was shifted off the drop point to avoid a neighbour. */
  nudged: boolean;
}

export interface WallPlaceOptions {
  width?: number;
  height?: number;
  sillHeight?: number;
  /** Ignore this opening when checking for overlaps (when moving it). */
  excludeOpeningId?: string;
  /** Restrict to one wall. */
  wallId?: string;
  maxSearch?: number;
}

/** Wall closest to `p` (within `maxDist` of its centerline) on a level. */
export function nearestWall(
  project: Project,
  levelId: string,
  p: Vec2,
  maxDist: number,
  only?: string,
): { wall: Wall; t: number; distance: number } | null {
  let best: { wall: Wall; t: number; distance: number } | null = null;
  for (const wall of project.walls) {
    if (wall.levelId !== levelId || (only && wall.id !== only)) continue;
    const r = projectOnSegment(p, wall.start, wall.end);
    if (r.distance <= maxDist && (!best || r.distance < best.distance))
      best = { wall, t: r.t, distance: r.distance };
  }
  return best;
}

/** Resolves where a door/window dropped at `point` ends up on the nearest wall, or why it can't go there. */
export function placeOnWall(
  project: Project,
  levelId: string,
  entry: CatalogEntry,
  point: Vec2,
  opts: WallPlaceOptions = {},
): Placed<WallPlacement> {
  const hit = nearestWall(project, levelId, point, opts.maxSearch ?? 0.9, opts.wallId);
  if (!hit) return { ok: false, message: t('msg.noWall') };
  const { wall } = hit;
  const units = project.units;
  const width = opts.width ?? entry.defaultSize.w;
  const height = opts.height ?? entry.defaultSize.h;
  const sillHeight = opts.sillHeight ?? entry.sill ?? 0;
  const len = wallLength(wall);
  const lo = width / 2 + OPENING_END_MARGIN;
  const hi = len - width / 2 - OPENING_END_MARGIN;
  if (hi < lo - 1e-9) {
    return {
      ok: false,
      message: tf('msg.wallTooShort', {
        len: formatLength(len, units),
        width: formatLength(width, units),
        name: name(entry),
      }),
    };
  }
  const wh = wallHeight(project, wall);
  if (sillHeight + height > wh + 1e-9) {
    return {
      ok: false,
      message: tf('msg.tooTall', {
        name: name(entry),
        height: formatLength(sillHeight + height, units),
        wall: formatLength(wh, units),
      }),
    };
  }
  const desired = Math.min(hi, Math.max(lo, Math.round((hit.t * len) / WALL_GRID) * WALL_GRID));
  const others = project.openings.filter(
    (o) => o.wallId === wall.id && o.id !== opts.excludeOpeningId,
  );
  const clear = (c: number) => !others.some((o) => openingsOverlap(o, { offset: c, width }));
  let offset = desired;
  let nudged = false;
  if (!clear(desired)) {
    const candidates = [
      lo,
      hi,
      ...others.flatMap((o) => [
        o.offset - o.width / 2 - width / 2,
        o.offset + o.width / 2 + width / 2,
      ]),
    ]
      .filter((c) => c >= lo - 1e-9 && c <= hi + 1e-9)
      .filter(clear)
      .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    const pick = candidates[0];
    if (pick === undefined)
      return { ok: false, message: tf('msg.wallFull', { name: name(entry) }) };
    if (Math.abs(pick - desired) > width * MAX_NUDGE)
      return { ok: false, message: t('msg.spotTaken') };
    offset = pick;
    nudged = true;
  }
  return {
    ok: true,
    wallId: wall.id,
    offset,
    width,
    height,
    sillHeight,
    distStart: offset - width / 2,
    distEnd: len - offset - width / 2,
    nudged,
  };
}

// ───────────────────────── Floor, wall-mounted & ceiling items ─────────────────────────

export interface ItemPlacement {
  position: Vec2;
  rotation: number;
  elevation: number;
  warnings: string[];
  snappedToWall: boolean;
}

export interface ItemPlaceOptions {
  rotation?: number;
  /** Item being moved (excluded from clearance checks). */
  excludeItemId?: string;
  /** Hold Alt etc. to turn wall snapping off. */
  snapWalls?: boolean;
  scale?: { x: number; y: number; z: number };
}

/** Rotation whose front (+y local) faces along unit vector n. */
const rotationFacing = (n: Vec2): number => Math.atan2(-n.x, n.y);

/** Clearance problems (never blocking) for an item footprint at a position. */
export function clearanceWarnings(
  project: Project,
  levelId: string,
  size: Size,
  position: Vec2,
  rotation: number,
  elevation: number,
  excludeItemId?: string,
): string[] {
  const out: string[] = [];
  if (size.h <= 0.03) return out; // rugs and mats may lie under anything
  const mine = boxCorners(position, size.w, size.d, rotation);
  const lo = elevation;
  const hi = elevation + size.h;
  for (const other of project.items) {
    if (other.levelId !== levelId || other.id === excludeItemId) continue;
    const oe = getEntry(other.catalogId);
    if (!oe) continue;
    const os = itemSize(oe, other.scale);
    if (os.h <= 0.03) continue;
    if (Math.min(hi, other.elevation + os.h) - Math.max(lo, other.elevation) < 0.05) continue;
    if (overlapDepth(mine, boxCorners(other.position, os.w, os.d, other.rotation)) > 0.03) {
      out.push(tf('msg.warnItem', { other: t(oe.nameKey as TranslationKey).toLowerCase() }));
    }
  }
  if (
    project.columns.some(
      (c) =>
        c.levelId === levelId &&
        overlapDepth(mine, boxCorners(c.position, c.size.w, c.size.d, 0)) > 0.03,
    ) &&
    lo < 2.5
  ) {
    out.push(t('msg.warnColumn'));
  }
  const level = project.levels.find((l) => l.id === levelId);
  const cutsWall = project.walls.some(
    (w) =>
      w.levelId === levelId && overlapDepth(mine, wallRect(w.start, w.end, w.thickness)) > 0.03,
  );
  if (cutsWall && lo < (level?.floorToCeiling ?? 2.7) - 0.3) out.push(t('msg.warnWall'));
  return [...new Set(out)];
}

/**
 * Where a floor / wall-mounted / ceiling item ends up when dropped at `point`:
 * rotation snaps to 15° steps, floor items snap back-to-wall when near one, wall-mounted items must sit on a wall.
 */
export function placeItem(
  project: Project,
  levelId: string,
  entry: CatalogEntry,
  point: Vec2,
  opts: ItemPlaceOptions = {},
): Placed<ItemPlacement> {
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) return { ok: false, message: t('msg.outside') };
  const size = itemSize(entry, opts.scale ?? { x: 1, y: 1, z: 1 });
  let rotation = snapAngle(opts.rotation ?? 0);
  let position = point;
  let snappedToWall = false;
  const wantsWall =
    entry.placement === 'wall-mounted' ||
    (entry.placement === 'floor' && entry.wallSnap !== false && opts.snapWalls !== false);

  if (wantsWall) {
    const reach = entry.placement === 'wall-mounted' ? 0.9 : WALL_SNAP_GAP + size.d / 2;
    let best: { wall: Wall; r: ReturnType<typeof projectOnSegment>; gap: number } | null = null;
    for (const wall of project.walls) {
      if (wall.levelId !== levelId) continue;
      const r = projectOnSegment(point, wall.start, wall.end);
      const gap = r.distance - wall.thickness / 2 - size.d / 2;
      if (r.distance - wall.thickness / 2 <= reach && (!best || gap < best.gap))
        best = { wall, r, gap };
    }
    if (best) {
      const { wall, r } = best;
      const dx = wall.end.x - wall.start.x;
      const dy = wall.end.y - wall.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const side =
        (point.x - r.point.x) * (-dy / len) + (point.y - r.point.y) * (dx / len) >= 0 ? 1 : -1;
      const n = { x: (side * -dy) / len, y: (side * dx) / len };
      // Slide along the wall with the pointer, but keep the item's ends on the wall's span.
      const along = Math.min(Math.max(0, r.t * len), len);
      const base = { x: wall.start.x + (dx / len) * along, y: wall.start.y + (dy / len) * along };
      position = {
        x: base.x + n.x * (wall.thickness / 2 + size.d / 2 + 0.002),
        y: base.y + n.y * (wall.thickness / 2 + size.d / 2 + 0.002),
      };
      rotation = rotationFacing(n);
      snappedToWall = true;
    } else if (entry.placement === 'wall-mounted') {
      return { ok: false, message: t('msg.needsWall') };
    }
  }

  const corners = boxCorners(position, size.w, size.d, rotation);
  const inside = corners.every((c) =>
    pointInPolygon(c, itemArea(project), ITEM_BOUNDS_TOLERANCE + 0.02),
  );
  if (!inside) return { ok: false, message: t('msg.outside') };

  const elevation =
    entry.placement === 'ceiling'
      ? Math.max(0, level.floorToCeiling - size.h)
      : entry.placement === 'wall-mounted'
        ? (entry.mountHeight ?? 1.2)
        : 0;
  const warnings = clearanceWarnings(
    project,
    levelId,
    size,
    position,
    rotation,
    elevation,
    opts.excludeItemId,
  );
  return { ok: true, position, rotation, elevation, warnings, snappedToWall };
}

/** Convenience for items already in the model. */
export function placeExistingItem(
  project: Project,
  item: Item,
  point: Vec2,
  opts: Omit<ItemPlaceOptions, 'scale' | 'excludeItemId'> = {},
): Placed<ItemPlacement> {
  const entry = getEntry(item.catalogId);
  if (!entry)
    return {
      ok: true,
      position: point,
      rotation: item.rotation,
      elevation: item.elevation,
      warnings: [],
      snappedToWall: false,
    };
  return placeItem(project, item.levelId, entry, point, {
    rotation: item.rotation,
    scale: item.scale,
    excludeItemId: item.id,
    ...opts,
  });
}
