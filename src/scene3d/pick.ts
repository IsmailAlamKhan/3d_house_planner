import { type Object3D, type Plane as PlaneT, Plane, type Raycaster, Vector3 } from 'three';
import type { Vec2 } from '../geometry/vec';
import type { CatalogEntry } from '../catalog';

/** Entity a mesh belongs to, looking a couple of levels up the scene graph (catalog objects are groups of meshes). */
export function entityOf(o: Object3D): { type: string; id: string } | undefined {
  let cur: Object3D | null = o;
  for (let i = 0; cur && i < 4; i++, cur = cur.parent) {
    const e = (cur.userData as { entity?: { type: string; id: string } }).entity;
    if (e) return e;
  }
  return undefined;
}

/** Where the ray meets the horizontal plane at `elevation` (the floor of the active level), as a plan point. */
export function floorPoint(ray: Raycaster['ray'], elevation: number): Vec2 | null {
  const plane: PlaneT = new Plane(new Vector3(0, 1, 0), -elevation);
  const hit = ray.intersectPlane(plane, new Vector3());
  return hit ? { x: hit.x, y: hit.z } : null;
}

/**
 * Plan point under the pointer for placing `entry`: doors/windows use the wall surface that was hit,
 * everything else uses the floor plane of the active level.
 */
export function pickPlanPoint(
  entry: CatalogEntry,
  raycaster: Raycaster,
  root: Object3D,
  elevation: number,
): Vec2 | null {
  if (entry.placement === 'wall') {
    for (const h of raycaster.intersectObjects(root.children, true)) {
      if (entityOf(h.object)?.type === 'wall') return { x: h.point.x, y: h.point.z };
    }
  }
  return floorPoint(raycaster.ray, elevation);
}
