import { DoubleSide, MeshStandardMaterial, type Plane } from 'three';
import { customTextureVersion, getTexture, resolveMaterial } from '../materials';
import type { MaterialOverride } from '../model/types';
import { registerClippable } from './clipping';
import { applySkyMix, capAlbedo } from './skyMix';

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
  rawKey: string,
  overrides: Record<string, MaterialOverride>,
  flags: MaterialFlags = {},
): MeshStandardMaterial {
  // `key@out` is the same material for outdoor surfaces (sky light reaches them even under realistic lighting).
  const outdoor = rawKey.endsWith('@out');
  const key = outdoor ? rawKey.slice(0, -4) : rawKey;
  const o = overrides[key];
  // Uploaded textures arrive from the server after start-up: their materials are rebuilt when that list changes.
  const id = `${key.startsWith('tex:') ? customTextureVersion() : ''}|${rawKey}|${o ? JSON.stringify(o) : ''}|${flags.ghost ? 'g' : ''}|${flags.clip ? `${flags.clip.constant}` : ''}|${flags.highlight ? 'h' : ''}`;
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
      emissive: flags.highlight ? '#0ea5e9' : '#000000',
      emissiveIntensity: flags.highlight ? 0.6 : 0,
    });
    capAlbedo(m.color);
    applySkyMix(m, outdoor);
    registerClippable(m, flags.clip);
    cache.set(id, m);
  }
  return m;
}
