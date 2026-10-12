import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { computeWallPolygons } from '../../geometry/walls';
import type { Vec2 } from '../../geometry/vec';
import type { Level, Project } from '../../model/types';
import { toRing } from '../generators/common';
import { slabVoids } from '../generators/voids';

export interface SectionState {
  /** Cuts everything above `height` (absolute, m). */
  horizontal: { on: boolean; height: number };
  /** Cuts everything beyond `pos` on one side of a vertical plane perpendicular to `axis`. */
  vertical: { on: boolean; axis: 'x' | 'z'; pos: number; flip: boolean };
}

export const defaultSection = (): SectionState => ({
  horizontal: { on: false, height: 1.2 },
  vertical: { on: false, axis: 'x', pos: 5, flip: false },
});

export interface ClipPlane {
  /** Plane normal (the kept side is where normal·p + constant ≥ 0). */
  normal: [number, number, number];
  constant: number;
}

/** Clipping planes (three.js convention) for the enabled sections. */
export function sectionPlanes(s: SectionState): ClipPlane[] {
  const out: ClipPlane[] = [];
  if (s.horizontal.on) out.push({ normal: [0, -1, 0], constant: s.horizontal.height });
  if (s.vertical.on) {
    const k = s.vertical.flip ? -1 : 1;
    out.push({
      normal: s.vertical.axis === 'x' ? [-k, 0, 0] : [0, 0, -k],
      constant: k * s.vertical.pos,
    });
  }
  return out;
}

export interface Rect {
  /** Along the cut plane (plan y for an x-plane, plan x for a z-plane). */
  u0: number;
  u1: number;
  /** Absolute heights. */
  y0: number;
  y1: number;
}

export interface Caps {
  /** Flat solid faces at `y` just under the horizontal cut. */
  horizontal: { y: number; shapes: MultiPolygon } | null;
  /** Solid faces on the vertical cut plane. */
  vertical: { axis: 'x' | 'z'; pos: number; rects: Rect[] } | null;
}

const BIG = 1e4;
const multi = (poly: Vec2[]): Polygon => [toRing(poly)];

/** Plan rectangle of an opening: along the wall ±width/2, across ±thickness/2 (+ a margin). */
function openingRect(
  wall: { start: Vec2; end: Vec2; thickness: number },
  offset: number,
  width: number,
): Vec2[] {
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const dx = (wall.end.x - wall.start.x) / len;
  const dy = (wall.end.y - wall.start.y) / len;
  const cx = wall.start.x + dx * offset;
  const cy = wall.start.y + dy * offset;
  const hw = width / 2;
  const ht = wall.thickness / 2 + 0.02;
  return [
    { x: cx - dx * hw - dy * ht, y: cy - dy * hw + dx * ht },
    { x: cx + dx * hw - dy * ht, y: cy + dy * hw + dx * ht },
    { x: cx + dx * hw + dy * ht, y: cy + dy * hw - dx * ht },
    { x: cx - dx * hw + dy * ht, y: cy - dy * hw - dx * ht },
  ];
}

const columnPolygon = (c: Project['columns'][number]): Vec2[] => {
  const hw = c.size.w / 2;
  const hd = c.size.d / 2;
  if (c.shape === 'round')
    return Array.from({ length: 16 }, (_, i) => ({
      x: c.position.x + Math.cos((i / 16) * Math.PI * 2) * hw,
      y: c.position.y + Math.sin((i / 16) * Math.PI * 2) * hd,
    }));
  return [
    { x: c.position.x - hw, y: c.position.y - hd },
    { x: c.position.x + hw, y: c.position.y - hd },
    { x: c.position.x + hw, y: c.position.y + hd },
    { x: c.position.x - hw, y: c.position.y + hd },
  ];
};

function horizontalCaps(project: Project, H: number): MultiPolygon {
  const pieces: Polygon[] = [];
  for (const level of project.levels) {
    const top = level.elevation + level.floorToCeiling;
    // Slab under the level.
    if (H <= level.elevation + 1e-9 && H >= level.elevation - level.slabThickness) {
      const voids = slabVoids(project, level);
      const slab = voids.length
        ? polygonClipping.difference(multi(project.shell.footprint), ...voids.map(multi))
        : [multi(project.shell.footprint)];
      pieces.push(...slab);
    }
    if (H < level.elevation || H > top) continue;
    const walls = project.walls.filter((w) => w.levelId === level.id);
    const polys = computeWallPolygons(walls);
    for (const wall of walls) {
      const poly = polys.get(wall.id);
      if (!poly) continue;
      const holes = project.openings
        .filter(
          (o) =>
            o.wallId === wall.id &&
            H >= level.elevation + o.sillHeight &&
            H <= level.elevation + o.sillHeight + o.height,
        )
        .map((o) => multi(openingRect(wall, o.offset, o.width)));
      pieces.push(
        ...(holes.length ? polygonClipping.difference(multi(poly), ...holes) : [multi(poly)]),
      );
    }
    for (const c of project.columns.filter((k) => k.levelId === level.id))
      pieces.push(multi(columnPolygon(c)));
  }
  if (!pieces.length) return [];
  const [first, ...rest] = pieces;
  return polygonClipping.union(first!, ...rest);
}

const strip = (axis: 'x' | 'z', pos: number): Polygon =>
  axis === 'x'
    ? [
        [
          [pos - 1e-4, -BIG],
          [pos + 1e-4, -BIG],
          [pos + 1e-4, BIG],
          [pos - 1e-4, BIG],
        ],
      ]
    : [
        [
          [-BIG, pos - 1e-4],
          [BIG, pos - 1e-4],
          [BIG, pos + 1e-4],
          [-BIG, pos + 1e-4],
        ],
      ];

/** Spans (along the plane) covered by a polygon where the plane cuts it. */
function spansOf(poly: Polygon, axis: 'x' | 'z', pos: number): [number, number][] {
  const cut = polygonClipping.intersection(poly, strip(axis, pos));
  return cut.map((p) => {
    const us = p[0]!.map(([x, y]) => (axis === 'x' ? y : x));
    return [Math.min(...us), Math.max(...us)] as [number, number];
  });
}

/** `r` minus the box [a,b] × [y0,y1]. */
function subtractRect(rects: Rect[], a: number, b: number, y0: number, y1: number): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    if (b <= r.u0 || a >= r.u1 || y1 <= r.y0 || y0 >= r.y1) {
      out.push(r);
      continue;
    }
    if (a > r.u0) out.push({ ...r, u1: a });
    if (b < r.u1) out.push({ ...r, u0: b });
    const u0 = Math.max(a, r.u0);
    const u1 = Math.min(b, r.u1);
    if (y0 > r.y0) out.push({ u0, u1, y0: r.y0, y1: y0 });
    if (y1 < r.y1) out.push({ u0, u1, y0: y1, y1: r.y1 });
  }
  return out;
}

function verticalCaps(project: Project, axis: 'x' | 'z', pos: number): Rect[] {
  const rects: Rect[] = [];
  for (const level of project.levels as Level[]) {
    const top = level.elevation + level.floorToCeiling;
    const slabBottom = level.elevation - level.slabThickness;
    const voids = slabVoids(project, level);
    const slab = voids.length
      ? polygonClipping.difference(multi(project.shell.footprint), ...voids.map(multi))
      : [multi(project.shell.footprint)];
    for (const poly of slab)
      for (const [u0, u1] of spansOf(poly, axis, pos))
        rects.push({ u0, u1, y0: slabBottom, y1: level.elevation });
    const walls = project.walls.filter((w) => w.levelId === level.id);
    const polys = computeWallPolygons(walls);
    for (const wall of walls) {
      const poly = polys.get(wall.id);
      if (!poly) continue;
      let list: Rect[] = spansOf(multi(poly), axis, pos).map(([u0, u1]) => ({
        u0,
        u1,
        y0: level.elevation,
        y1: level.elevation + (wall.height ?? level.floorToCeiling),
      }));
      if (!list.length) continue;
      for (const o of project.openings.filter((x) => x.wallId === wall.id)) {
        for (const [a, b] of spansOf(multi(openingRect(wall, o.offset, o.width)), axis, pos))
          list = subtractRect(
            list,
            a,
            b,
            level.elevation + o.sillHeight,
            level.elevation + o.sillHeight + o.height,
          );
      }
      rects.push(...list);
    }
    for (const c of project.columns.filter((k) => k.levelId === level.id))
      for (const [u0, u1] of spansOf(multi(columnPolygon(c)), axis, pos))
        rects.push({ u0, u1, y0: level.elevation, y1: top });
  }
  return rects.filter((r) => r.u1 - r.u0 > 1e-4 && r.y1 - r.y0 > 1e-4);
}

/** Solid faces to draw on the cut planes so sectioned walls, slabs and columns look solid instead of hollow. */
export function sectionCaps(project: Project, s: SectionState): Caps {
  return {
    horizontal: s.horizontal.on
      ? { y: s.horizontal.height, shapes: horizontalCaps(project, s.horizontal.height) }
      : null,
    vertical: s.vertical.on
      ? {
          axis: s.vertical.axis,
          pos: s.vertical.pos,
          rects: verticalCaps(project, s.vertical.axis, s.vertical.pos),
        }
      : null,
  };
}
