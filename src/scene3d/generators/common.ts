import {
  BufferGeometry,
  ExtrudeGeometry,
  type Object3D,
  Path,
  Shape,
  ShapeGeometry,
  Mesh,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import polygonClipping, {
  type MultiPolygon,
  type Pair,
  type Polygon,
  type Ring,
} from 'polygon-clipping';
import type { Vec2 } from '../../geometry/vec';
import type { EntityType } from '../../model/types';

export type Layer =
  'wall' | 'frame' | 'slab' | 'floor' | 'ceiling' | 'column' | 'stair' | 'roof' | 'item' | 'site';

/**
 * One renderable piece of the model. Geometry is in LEVEL-LOCAL coordinates:
 * plan (x, y) → (x, height above this level's finished floor, y). The scene places the level at its elevation.
 */
export interface Part {
  id: string;
  layer: Layer;
  /** The model entity a click on this part selects. */
  entity?: { type: EntityType; id: string };
  geometry: BufferGeometry;
  /** Material keys; geometry groups index into this list (a lone entry covers the whole geometry). */
  materials: string[];
  /** Part is thin trim that should be clipped by the "walls cut" plane instead of rebuilt. */
  clipToCut?: boolean;
}

/** A renderable piece made of a ready-built three.js object (catalog furniture, doors and windows). */
export interface ObjectPart {
  id: string;
  layer: Layer;
  entity?: { type: EntityType; id: string };
  /** Positioned in level-local coordinates. Materials are shared and must not be mutated. */
  object: Object3D;
  clipToCut?: boolean;
  /** Contains glowing lamp surfaces (they light up when the interior lights are on). */
  lamp?: boolean;
}

export type AnyPart = Part | ObjectPart;

export const isObjectPart = (p: AnyPart): p is ObjectPart => 'object' in p;

export function disposeParts(parts: AnyPart[]): void {
  for (const p of parts) {
    if (isObjectPart(p)) p.object.traverse((o) => o instanceof Mesh && o.geometry.dispose());
    else p.geometry.dispose();
  }
}

export const toRing = (pts: Vec2[]): Ring => pts.map((p) => [p.x, p.y] as Pair);

/** `subject` minus `holes` (holes outside it are ignored). Result polygons are [outer, ...holes]. */
export function subtractPolygons(subject: Vec2[], holes: Vec2[][]): MultiPolygon {
  const s: Polygon = [toRing(subject)];
  if (!holes.length) return [s];
  return polygonClipping.difference(s, ...holes.map((h): Polygon => [toRing(h)]));
}

export function unionPolygons(polys: Vec2[][]): MultiPolygon {
  if (!polys.length) return [];
  const [first, ...rest] = polys.map((p): Polygon => [toRing(p)]);
  return polygonClipping.union(first!, ...rest);
}

const stripClose = (ring: Ring): Ring => {
  const a = ring[0];
  const b = ring[ring.length - 1];
  return a && b && ring.length > 1 && a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring;
};

/**
 * Shape in the mirrored-plan frame (x, -planY): rotating the resulting flat/extruded geometry about X
 * by −π/2 puts plan (x, y) at world (x, h, y).
 */
export function shapeFromPolygon(poly: Polygon): Shape {
  const [outer, ...holes] = poly.map(stripClose);
  const shape = new Shape(outer!.map(([x, y]) => ({ x, y: -y }) as never));
  for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => ({ x, y: -y }) as never)));
  return shape;
}

/** Vertical prism of a (multi)polygon from y=y0 up by `depth`. Returns null when empty. */
export function extrudeMulti(multi: MultiPolygon, depth: number, y0 = 0): BufferGeometry | null {
  const geos = multi.map((poly) => {
    const g = new ExtrudeGeometry(shapeFromPolygon(poly), { depth, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  });
  return mergeOrNull(geos);
}

/** Reverses triangle winding and normals so the surface faces the other way. */
export function flipFaces(g: BufferGeometry): BufferGeometry {
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = g.getAttribute('normal');
  if (n) {
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    n.needsUpdate = true;
  }
  return g;
}

/** Flat horizontal surface at height y. `up` = normal points +y (floors); otherwise −y (ceilings). */
export function flatMulti(multi: MultiPolygon, y: number, up: boolean): BufferGeometry | null {
  const geos = multi.map((poly) => {
    const g = new ShapeGeometry(shapeFromPolygon(poly));
    g.rotateX(-Math.PI / 2);
    if (!up) flipFaces(g);
    g.translate(0, y, 0);
    return g;
  });
  return mergeOrNull(geos);
}

function mergeOrNull(geos: BufferGeometry[]): BufferGeometry | null {
  if (!geos.length) return null;
  if (geos.length === 1) return geos[0]!;
  // Indexed (box, cylinder) and non-indexed (extrusion) geometries cannot be merged directly.
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  geos.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  return merged;
}

export const mergeAll = mergeOrNull;
