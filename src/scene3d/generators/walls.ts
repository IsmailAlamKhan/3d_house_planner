import { ExtrudeGeometry, Matrix4, Path, Shape, type BufferGeometry } from 'three';
import { type Vec2, dist, dot, sub } from '../../geometry/vec';
import { insideSign } from '../../model/integrity';
import type { Opening, Wall } from '../../model/types';

export { insideSign };
import type { Part } from './common';

const EPS = 1e-4;

export interface WallBuildInput {
  wall: Wall;
  /** Mitred outline from `computeWallPolygons`: [startLeft, endLeft, endRight, startRight]. */
  polygon: Vec2[];
  openings: Opening[];
  /** Wall height (m), already limited by the view mode (e.g. 1.2 for "cut"). */
  height: number;
  /** Shell footprint, used to decide which face of an exterior wall is the outside. */
  footprint: Vec2[];
}

/** Rectangular interval of a wall elevation (wall-local u along, v up). */
interface Hole {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Wall-local (u along, h up, z across) → level-local world matrix. z>0 is the wall's left side. */
export function wallMatrix(wall: Pick<Wall, 'start' | 'end'>): Matrix4 {
  const a = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  return new Matrix4().makeRotationY(-a).setPosition(wall.start.x, 0, wall.start.y);
}

export function openingHoles(openings: Opening[], length: number, height: number): Hole[] {
  const holes: Hole[] = [];
  for (const o of openings) {
    const u0 = Math.max(EPS, o.offset - o.width / 2);
    const u1 = Math.min(length - EPS, o.offset + o.width / 2);
    const v0 = Math.max(0, o.sillHeight);
    // Keep a hairline of wall above so the elevation stays one connected shape.
    const v1 = Math.min(o.sillHeight + o.height, height - 0.002);
    if (u1 - u0 < EPS || v1 - v0 < EPS || v0 >= height) continue;
    holes.push({ u0, u1, v0, v1 });
  }
  return holes.sort((a, b) => a.u0 - b.u0);
}

/** Elevation outline with door-type openings (sill 0) notched from the bottom and the rest as holes. */
export function wallShape(length: number, height: number, holes: Hole[]): Shape {
  const shape = new Shape();
  shape.moveTo(0, 0);
  for (const h of holes.filter((h) => h.v0 <= 1e-6)) {
    shape.lineTo(h.u0, 0);
    shape.lineTo(h.u0, h.v1);
    shape.lineTo(h.u1, h.v1);
    shape.lineTo(h.u1, 0);
  }
  shape.lineTo(length, 0);
  shape.lineTo(length, height);
  shape.lineTo(0, height);
  shape.closePath();
  for (const h of holes.filter((h) => h.v0 > 1e-6)) {
    const p = new Path();
    p.moveTo(h.u0, h.v0);
    p.lineTo(h.u1, h.v0);
    p.lineTo(h.u1, h.v1);
    p.lineTo(h.u0, h.v1);
    p.closePath();
    shape.holes.push(p);
  }
  return shape;
}

/**
 * Builds one wall as an extruded elevation (Shape with holes, no CSG), mitred at its ends,
 * with the two faces in separate material groups: materials = [leftFace, rightFace, edges].
 */
export function generateWall({
  wall,
  polygon,
  openings,
  height,
  footprint,
}: WallBuildInput): Part | null {
  const length = dist(wall.start, wall.end);
  if (length < EPS || height < EPS) return null;
  const t = wall.thickness;
  const shape = wallShape(length, height, openingHoles(openings, length, height));
  const geo = new ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geo.translate(0, 0, -t / 2);

  // Mitre: slide end-cap vertices along the wall so adjoining walls meet cleanly.
  const d = sub(wall.end, wall.start);
  const dir = { x: d.x / length, y: d.y / length };
  const [sl, el, er, sr] = polygon as [Vec2, Vec2, Vec2, Vec2];
  const proj = (p: Vec2) => dot(sub(p, wall.start), dir);
  const uStart = { left: proj(sl), right: proj(sr) };
  const uEnd = { left: proj(el), right: proj(er) };
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const left = pos.getZ(i) > 0;
    if (Math.abs(u) < 1e-6) pos.setX(i, left ? uStart.left : uStart.right);
    else if (Math.abs(u - length) < 1e-6) pos.setX(i, left ? uEnd.left : uEnd.right);
  }
  pos.needsUpdate = true;

  // ExtrudeGeometry puts both large faces in group 0 (front lid first, then back lid) and edges in group 1.
  const lids = geo.groups.find((g) => g.materialIndex === 0);
  const sides = geo.groups.find((g) => g.materialIndex === 1);
  geo.clearGroups();
  if (lids) {
    const half = lids.count / 2;
    // Front lid sits at z = -t/2 (right side); back lid at z = +t/2 (left side).
    geo.addGroup(lids.start, half, 1);
    geo.addGroup(lids.start + half, half, 0);
  }
  if (sides) geo.addGroup(sides.start, sides.count, 2);

  geo.applyMatrix4(wallMatrix(wall));
  geo.computeVertexNormals();
  const inside = insideSign(wall, footprint);
  const leftKey = inside === 1 ? wall.materialInside : wall.materialOutside;
  const rightKey = inside === 1 ? wall.materialOutside : wall.materialInside;
  return {
    id: `wall:${wall.id}`,
    layer: 'wall',
    entity: { type: 'wall', id: wall.id },
    geometry: geo as BufferGeometry,
    materials: [leftKey, rightKey, 'wall-edge'],
  };
}
