import { Box3, type BufferGeometry, Group, Mesh, type Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Raw size of a model in its own units (glTF says metres). */
export interface ModelSize {
  w: number;
  h: number;
  d: number;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Object3D>>();

/** Parses a binary glTF (.glb) held in memory. Rejects with a readable message when it is not a usable model. */
export async function parseGlb(data: ArrayBuffer): Promise<Object3D> {
  let scene: Object3D;
  try {
    scene = (await loader.parseAsync(data, '')).scene;
  } catch {
    throw new Error('This file could not be read as a 3D model. Use a .glb (binary glTF) file.');
  }
  let meshes = 0;
  scene.traverse((o) => {
    if (o instanceof Mesh) meshes++;
  });
  if (meshes === 0) throw new Error('This model has no geometry to show.');
  return scene;
}

/** The parsed model of an uploaded asset (downloaded once, then kept). */
export function loadModel(assetId: string, url: string): Promise<Object3D> {
  let p = cache.get(assetId);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`The model file is not available (${r.status}).`);
        return r.arrayBuffer();
      })
      .then(parseGlb);
    p.catch(() => cache.delete(assetId)); // allow a retry later
    cache.set(assetId, p);
  }
  return p;
}

export const forgetModel = (assetId: string): void => void cache.delete(assetId);

/** Bounding-box size of a model. */
export function measureModel(root: Object3D): ModelSize {
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root);
  const s = box.getSize(new Vector3());
  return { w: s.x, h: s.y, d: s.z };
}

/**
 * A fresh copy of the model, stretched to exactly `size` (metres), standing on the floor with its footprint centred on
 * the origin and its front toward +z (the catalogue convention). Geometry is cloned per copy because the scene
 * builder disposes geometry when it rebuilds; materials are shared.
 */
export function fitModel(root: Object3D, size: ModelSize): Group {
  const copy = root.clone(true);
  copy.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry = (o.geometry as BufferGeometry).clone();
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const raw = new Box3().setFromObject(copy);
  const rs = raw.getSize(new Vector3());
  const sx = rs.x > 1e-6 ? size.w / rs.x : 1;
  const sy = rs.y > 1e-6 ? size.h / rs.y : 1;
  const sz = rs.z > 1e-6 ? size.d / rs.z : 1;
  const c = raw.getCenter(new Vector3());
  const holder = new Group();
  copy.position.set(-c.x, -raw.min.y, -c.z);
  holder.add(copy);
  holder.scale.set(sx, sy, sz);
  const out = new Group();
  out.add(holder);
  return out;
}
