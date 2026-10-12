import { type Material, Plane, Vector3 } from 'three';

/**
 * Section planes clip the MODEL only (not the sky or the ground grid), so they are applied per material rather than
 * on the renderer. Every material the model uses registers itself here; a material may also carry its own plane
 * (the "walls cut at 1.2 m" view).
 */
const pool = [new Plane(new Vector3(0, -1, 0), 0), new Plane(new Vector3(0, -1, 0), 0)];
let active: Plane[] = [];
const targets = new Map<Material, Plane | undefined>();

function assign(m: Material, own: Plane | undefined): void {
  const list = own ? [own, ...active] : active;
  m.clippingPlanes = list.length ? list : null;
  // A cut-away part must not keep casting its shadow.
  m.clipShadows = true;
}

/** Makes `m` follow the current section planes. Returns the material for chaining. */
export function registerClippable<T extends Material>(m: T, own?: Plane): T {
  if (targets.get(m) === own && targets.has(m)) return m;
  targets.set(m, own);
  assign(m, own);
  return m;
}

/** Sets the enabled section planes (at most two; the kept side is where normal·p + constant ≥ 0). */
export function setSectionPlanes(
  planes: { normal: [number, number, number]; constant: number }[],
): void {
  active = planes.slice(0, pool.length).map((p, i) => {
    const plane = pool[i]!;
    plane.normal.set(...p.normal);
    plane.constant = p.constant;
    return plane;
  });
  for (const [m, own] of targets) assign(m, own);
}
