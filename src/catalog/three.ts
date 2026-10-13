import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { applySkyMix, capAlbedo } from '../scene3d/skyMix';
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
} from 'three';

const materials = new Map<string, MeshStandardMaterial>();

/** Shared material for a color (cached — catalog models are built often). */
export function mat(
  color: string,
  roughness = 0.7,
  metalness = 0,
  opacity = 1,
): MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}|${opacity}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    });
    capAlbedo(m.color);
    applySkyMix(m);
    materials.set(key, m);
  }
  return m;
}

type V3 = [number, number, number];

function finish(mesh: Mesh, parent: Object3D, at: V3, opts: { shadow?: boolean } = {}): Mesh {
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = opts.shadow ?? true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Bevel radius for a box: about 1.4 cm, less on thin pieces, none on films and rugs. */
export function bevelOf(size: V3): number {
  const m = Math.min(size[0], size[1], size[2]);
  return m < 0.045 ? 0 : Math.min(0.014, m * 0.18);
}

/** Box of size [w,h,d] whose bottom-center is at `at`. */
export function box(
  parent: Object3D,
  size: V3,
  at: V3,
  color: string,
  rough = 0.7,
  opacity = 1,
  metal = 0,
): Mesh {
  // Small rounded edges catch the light: without them white furniture melts into white walls and floors.
  const r = bevelOf(size);
  const mesh = new Mesh(
    r > 0
      ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, r)
      : new BoxGeometry(size[0], size[1], size[2]),
    mat(color, rough, metal, opacity),
  );
  return finish(mesh, parent, [at[0], at[1] + size[1] / 2, at[2]], { shadow: opacity >= 1 });
}

/** Vertical cylinder (or cone when radii differ) whose bottom-center is at `at`. */
export function cyl(
  parent: Object3D,
  rTop: number,
  rBottom: number,
  h: number,
  at: V3,
  color: string,
  rough = 0.7,
  segments = 20,
  metal = 0,
  opacity = 1,
): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(rTop, rBottom, h, segments),
    mat(color, rough, metal, opacity),
  );
  return finish(mesh, parent, [at[0], at[1] + h / 2, at[2]], { shadow: opacity >= 1 });
}

export function sphere(parent: Object3D, r: number, at: V3, color: string, rough = 0.8): Mesh {
  const mesh = new Mesh(new SphereGeometry(r, 16, 12), mat(color, rough));
  return finish(mesh, parent, at);
}

export const group = (): Group => new Group();

/** Disposes every geometry under an object (materials are shared and kept). */
export function disposeObject(o: Object3D): void {
  o.traverse((c) => {
    if (c instanceof Mesh) c.geometry.dispose();
  });
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
