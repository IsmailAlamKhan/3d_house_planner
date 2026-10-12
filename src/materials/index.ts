import type { MaterialOverride } from '../model/types';

/** Rendering description of a material key. The full library (textures, picker) arrives in a later prompt. */
export interface MaterialSpec {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
}

const base = (color: string, roughness = 0.85, metalness = 0, opacity = 1): MaterialSpec => ({
  color,
  roughness,
  metalness,
  opacity,
});

const BUILTIN: Record<string, MaterialSpec> = {
  'paint-white': base('#f5f5f4'),
  'paint-cream': base('#f3e9d2'),
  'paint-grey': base('#b8bcc2'),
  'brick-red': base('#a8553a', 0.95),
  concrete: base('#9ca3af', 0.95),
  'wood-panel': base('#a9794d', 0.7),
  'tile-white': base('#e8ecef', 0.35),
  'floor-oak': base('#c69c6d', 0.6),
  'floor-walnut': base('#6b4a33', 0.6),
  'floor-tile-grey': base('#9aa1a8', 0.4),
  'floor-tile-white': base('#dfe3e6', 0.35),
  'floor-concrete': base('#8f969c', 0.95),
  'floor-carpet-grey': base('#7c838a', 1),
  // Structural / fixed keys used by the 3D generators
  'wall-edge': base('#d6d3d1'),
  slab: base('#bfc3c8', 0.95),
  ceiling: base('#fafafa'),
  roof: base('#6b7280', 0.9),
  column: base('#9ca3af', 0.9),
  stair: base('#cfa77a', 0.65),
  rail: base('#374151', 0.5, 0.4),
  frame: base('#e5e7eb', 0.5),
  leaf: base('#b9814e', 0.6),
  glass: base('#a5d8ff', 0.05, 0, 0.35),
};

const FALLBACK = base('#cbd5e1');

/** Resolves a material key to a render spec, applying any per-project color override. */
export function resolveMaterial(
  key: string,
  overrides: Record<string, MaterialOverride> = {},
): MaterialSpec {
  const spec = BUILTIN[key] ?? FALLBACK;
  const o = overrides[key];
  if (!o) return spec;
  return {
    ...spec,
    color: o.color ?? spec.color,
    roughness: o.roughness ?? spec.roughness,
    metalness: o.metalness ?? spec.metalness,
  };
}
