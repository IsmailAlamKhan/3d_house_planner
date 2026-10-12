import { type Material, Mesh, type MeshStandardMaterial, type Object3D, type Plane } from 'three';

const variants = new Map<string, Material>();

export interface ObjectFlags {
  highlight: boolean;
  clip?: Plane;
}

/** Shared material variant (selection tint and/or clipping plane) so many instances reuse a few materials. */
function variantOf(base: Material, flags: ObjectFlags): Material {
  const std = base as MeshStandardMaterial;
  if (!flags.highlight && !flags.clip) return base;
  const key = `${base.uuid}|${flags.highlight ? 'h' : ''}|${flags.clip ? flags.clip.constant : ''}`;
  let v = variants.get(key);
  if (!v) {
    v = base.clone();
    if (flags.highlight && 'emissive' in std) {
      (v as MeshStandardMaterial).emissive.set('#0ea5e9');
      (v as MeshStandardMaterial).emissiveIntensity = 0.55;
    }
    if (flags.clip) v.clippingPlanes = [flags.clip];
    variants.set(key, v);
  }
  return v;
}

/**
 * A render copy of a catalog object: shares geometry with the cached template, swaps in tinted / clipped
 * material variants when needed. The template itself is never mutated.
 */
export function prepareObject(template: Object3D, flags: ObjectFlags): Object3D {
  const copy = template.clone(true);
  copy.traverse((o) => {
    if (o instanceof Mesh)
      o.material = Array.isArray(o.material)
        ? o.material.map((m: Material) => variantOf(m, flags))
        : variantOf(o.material as Material, flags);
  });
  return copy;
}
