import { nanoid } from 'nanoid';
import { pointInPolygon, polygonArea } from '../geometry/polygon';
import { type Vec2, dist, projectOnSegment } from '../geometry/vec';
import { t } from '../i18n';
import { createEmptyProject } from '../model/project';
import { addColumn, addLevel, addOpening, addWall, syncRooms, updateLevel } from '../model/ops';
import type { Beam, FacadeWindow, Point, Project } from '../model/types';
import { produce } from 'immer';

export type ShapeKind = 'rectangle' | 'L' | 'custom';

export interface ShellConfig {
  name: string;
  shape: ShapeKind;
  width: number;
  depth: number;
  /** L-shape: size of the missing corner and which corner it is. */
  notchW: number;
  notchD: number;
  notchCorner: 'ne' | 'nw' | 'se' | 'sw';
  custom: Point[];
  /** Total height, slab to slab (m). */
  totalHeight: number;
  /** Ground-level storey height; the upper storey gets the rest. */
  groundHeight: number;
  columns: { position: Point; size: number }[];
  beams: Beam[];
  plumbing: Point[];
  entrance: { position: Point; direction: number };
  windows: FacadeWindow[];
}

export const SLAB = 0.2;

export const defaultConfig = (): ShellConfig => ({
  name: 'My Duplex Home',
  shape: 'rectangle',
  width: 10,
  depth: 12,
  notchW: 4,
  notchD: 4,
  notchCorner: 'ne',
  custom: [],
  totalHeight: 5.8,
  groundHeight: 2.8,
  columns: [],
  beams: [],
  plumbing: [],
  entrance: { position: { x: 10, y: 6 }, direction: 0 },
  windows: [],
});

/** Footprint polygon (counter-clockwise on screen, starting top-left) for the chosen shape. */
export function footprintOf(c: ShellConfig): Point[] {
  if (c.shape === 'custom') return c.custom;
  const { width: w, depth: d } = c;
  if (c.shape === 'rectangle')
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ];
  const nw = Math.min(c.notchW, w - 1);
  const nd = Math.min(c.notchD, d - 1);
  switch (c.notchCorner) {
    case 'ne':
      return [
        { x: 0, y: 0 },
        { x: w - nw, y: 0 },
        { x: w - nw, y: nd },
        { x: w, y: nd },
        { x: w, y: d },
        { x: 0, y: d },
      ];
    case 'nw':
      return [
        { x: nw, y: 0 },
        { x: w, y: 0 },
        { x: w, y: d },
        { x: 0, y: d },
        { x: 0, y: nd },
        { x: nw, y: nd },
      ];
    case 'se':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: d - nd },
        { x: w - nw, y: d - nd },
        { x: w - nw, y: d },
        { x: 0, y: d },
      ];
    case 'sw':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: d },
        { x: nw, y: d },
        { x: nw, y: d - nd },
        { x: 0, y: d - nd },
      ];
  }
}

const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** Problems with a footprint, in plain language (empty = fine). */
export function validateFootprint(poly: Point[]): string[] {
  const out: string[] = [];
  if (poly.length < 3) return [t('wiz.err.points')];
  if (polygonArea(poly) < 15) out.push(t('wiz.err.small'));
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 2; j < poly.length; j++) {
      if (i === 0 && j === poly.length - 1) continue;
      if (
        segmentsCross(
          poly[i]!,
          poly[(i + 1) % poly.length]!,
          poly[j]!,
          poly[(j + 1) % poly.length]!,
        )
      ) {
        out.push(t('wiz.err.cross'));
        return out;
      }
    }
  }
  return out;
}

export interface HeightPlan {
  ground: number;
  upper: number;
  /** Warnings in plain language. */
  warnings: string[];
  ok: boolean;
}

/** Splits the slab-to-slab height into two storeys (ground + slab + upper) and warns about low ceilings. */
export function planHeights(total: number, ground?: number): HeightPlan {
  const warnings: string[] = [];
  const room = total - SLAB;
  if (room < 4.4) {
    warnings.push(t('wiz.err.noFit').replace('{h}', total.toFixed(2)));
  }
  const g = ground ?? Math.round((room / 2) * 100) / 100;
  const u = Math.round((room - g) * 100) / 100;
  if (g < 2.4) warnings.push(t('wiz.warn.ground').replace('{h}', g.toFixed(2)));
  if (u < 2.4) warnings.push(t('wiz.warn.upper').replace('{h}', u.toFixed(2)));
  return { ground: g, upper: u, warnings, ok: room >= 4.4 && g >= 2.4 && u >= 2.4 };
}

/** Nearest point on the footprint outline, with the outward direction (radians) of that edge. */
export function snapToOutline(
  poly: Point[],
  p: Point,
): { point: Point; edge: number; offset: number; direction: number } {
  let best = { point: poly[0]!, edge: 0, offset: 0, direction: 0, d: Infinity };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const r = projectOnSegment(p, a, b);
    if (r.distance < best.d) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = dy / len;
      let ny = -dx / len;
      // Make the normal point away from the inside.
      const probe = { x: r.point.x + nx * 0.2, y: r.point.y + ny * 0.2 };
      if (pointInPolygon(probe, poly)) {
        nx = -nx;
        ny = -ny;
      }
      best = {
        point: r.point,
        edge: i,
        offset: dist(a, r.point),
        direction: Math.atan2(ny, nx),
        d: r.distance,
      };
    }
  });
  return { point: best.point, edge: best.edge, offset: best.offset, direction: best.direction };
}

/** A fresh project from the wizard: shell, two levels, exterior walls, locked facade windows and fixed elements. */
export function projectFromConfig(c: ShellConfig): Project {
  const poly = footprintOf(c);
  const heights = planHeights(c.totalHeight, c.groundHeight);
  const base = createEmptyProject(c.name);
  return produce(base, (p) => {
    p.shell.footprint = poly;
    p.shell.maxHeight = c.totalHeight;
    p.shell.entrance = c.entrance;
    p.shell.fixedPlumbingPoints = c.plumbing;
    p.shell.beams = c.beams;
    p.shell.windows = c.windows;
    const ground = p.levels[0]!.id;
    const upper = addLevel(p, { name: 'Upper floor' });
    updateLevel(p, ground, { floorToCeiling: heights.ground, name: 'Ground floor' });
    updateLevel(p, upper, { floorToCeiling: heights.upper });
    for (const lvl of [ground, upper]) {
      for (const col of c.columns)
        addColumn(p, { levelId: lvl, position: col.position, size: { w: col.size, d: col.size } });
      addShellWalls(p, lvl);
    }
    for (const lvl of [ground, upper]) syncRooms(p, lvl);
    for (const r of p.rooms) r.name = r.levelId === ground ? 'Open space' : 'Open space (upper)';
  });
}

/** Exterior walls along the footprint of one level, plus the building's existing windows as LOCKED openings. */
export function addShellWalls(p: Project, levelId: string): void {
  const fp = p.shell.footprint;
  const wallIds: string[] = [];
  fp.forEach((a, i) => {
    wallIds.push(
      addWall(p, {
        levelId,
        start: a,
        end: fp[(i + 1) % fp.length]!,
        type: 'exterior',
        thickness: 0.3,
        materialOutside: 'brick-red',
      }),
    );
  });
  addFacadeWindows(p, levelId, wallIds);
}

/** Adds the locked opening for every facade window (skipping ones that do not fit). */
export function addFacadeWindows(p: Project, levelId: string, wallIds?: string[]): void {
  const fp = p.shell.footprint;
  for (const w of p.shell.windows) {
    const a = fp[w.edge];
    const b = fp[(w.edge + 1) % fp.length];
    if (!a || !b) continue;
    const len = dist(a, b) || 1;
    const centre = {
      x: a.x + ((b.x - a.x) / len) * w.offset,
      y: a.y + ((b.y - a.y) / len) * w.offset,
    };
    const wall = p.walls.find(
      (x) =>
        x.levelId === levelId &&
        x.type === 'exterior' &&
        (!wallIds || wallIds.includes(x.id)) &&
        projectOnSegment(centre, x.start, x.end).distance < 0.02,
    );
    if (!wall) continue;
    try {
      addOpening(p, {
        wallId: wall.id,
        offset: dist(wall.start, centre),
        kind: 'window',
        catalogId: 'window-casement',
        width: w.width,
        height: w.height,
        sillHeight: w.sillHeight,
        locked: true,
      });
    } catch {
      // A window that does not fit the wall is skipped.
    }
  }
}

export const newId = (): string => nanoid(10);
