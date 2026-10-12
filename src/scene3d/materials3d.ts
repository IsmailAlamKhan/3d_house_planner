import { DoubleSide, MeshStandardMaterial, type Plane } from 'three';
import { getTexture, resolveMaterial } from '../materials';
import type { MaterialOverride } from '../model/types';

const cache = new Map<string, MeshStandardMaterial>();

export interface MaterialFlags {
  /** Render as see-through (walls in "transparent" mode). */
  ghost?: boolean;
  /** Tint as part of the current selection. */
  highlight?: boolean;
  /** Clip everything above this plane (thin trim in "walls cut" mode). */
  clip?: Plane;
}

/** Shared three.js material for a material key, cached by key + variant. */
export function getMaterial(
  key: string,
  overrides: Record<string, MaterialOverride>,
  flags: MaterialFlags = {},
): MeshStandardMaterial {
  const o = overrides[key];
  const id = `${key}|${o ? JSON.stringify(o) : ''}|${flags.ghost ? 'g' : ''}|${flags.clip ? `${flags.clip.constant}` : ''}|${flags.highlight ? 'h' : ''}`;
  let m = cache.get(id);
  if (!m) {
    const spec = resolveMaterial(key, overrides);
    const map = getTexture(spec.def);
    const translucent = spec.opacity < 1 || flags.ghost;
    m = new MeshStandardMaterial({
      // A texture already carries the colour; only an explicit override tints it.
      color: map ? (overrides[key]?.color ?? '#ffffff') : spec.color,
      map,
      roughness: spec.roughness,
      metalness: spec.metalness,
      transparent: translucent,
      opacity: flags.ghost ? Math.min(spec.opacity, 0.25) : spec.opacity,
      depthWrite: !translucent,
      side: key === 'glass' ? DoubleSide : undefined,
      clippingPlanes: flags.clip ? [flags.clip] : null,
      emissive: flags.highlight ? '#0ea5e9' : '#000000',
      emissiveIntensity: flags.highlight ? 0.6 : 0,
    });
    cache.set(id, m);
  }
  return m;
}
