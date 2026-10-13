import { type Material, Mesh, type MeshStandardMaterial, type Object3D, type Plane } from 'three';

import { registerClippable } from './clipping';
import { applySkyMix } from './skyMix';

const variants = new Map<string, Material>();

export interface ObjectFlags {
  highlight: boolean;
  /** Make lamp surfaces (meshes marked `userData.lamp`) glow. */
  lit?: boolean;
  clip?: Plane;
  /** Draw faintly (isolation of another room, x-ray). */
  ghost?: boolean;
  /** Garden furniture and plants: sky light reaches them even under realistic lighting. */
  outdoor?: boolean;
}

/** Shared material variant (selection tint, lamp glow and/or clipping plane) so many instances reuse a few materials. */
function variantOf(base: Material, flags: ObjectFlags, isLamp: boolean): Material {
  const glow = !!flags.lit && isLamp;
  if (!flags.highlight && !flags.clip && !glow && !flags.ghost && !flags.outdoor)
    return registerClippable(base);
  const key = `${base.uuid}|${flags.outdoor ? 'o' : ''}|${flags.highlight ? 'h' : ''}|${glow ? 'l' : ''}|${flags.ghost ? 'g' : ''}|${flags.clip ? flags.clip.constant : ''}`;
  let v = variants.get(key);
  if (!v) {
    const clone = base.clone() as MeshStandardMaterial;
    applySkyMix(clone, flags.outdoor);
    if (glow && 'emissive' in clone) {
      clone.emissive.copy(clone.color);
      clone.emissiveIntensity = 1.8;
    }
    if (flags.highlight && 'emissive' in clone) {
      clone.emissive.set('#0ea5e9');
      clone.emissiveIntensity = 0.55;
    }
    if (flags.ghost) {
      clone.transparent = true;
      clone.opacity = Math.min(clone.opacity, 0.18);
      clone.depthWrite = false;
    }
    variants.set(key, clone);
    v = registerClippable(clone, flags.clip);
  }
  return v;
}

/**
 * A render copy of a catalog object: shares geometry with the cached template, swaps in tinted / glowing / clipped
 * material variants when needed. The template itself is never mutated.
 */
export function prepareObject(template: Object3D, flags: ObjectFlags): Object3D {
  const copy = template.clone(true);
  copy.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const lamp = o.userData.lamp === true;
    o.material = Array.isArray(o.material)
      ? o.material.map((m: Material) => variantOf(m, flags, lamp))
      : variantOf(o.material as Material, flags, lamp);
  });
  return copy;
}
