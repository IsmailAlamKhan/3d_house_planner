import type { MaterialOverride } from '../model/types';
import { type MaterialDef, resolveDef } from './library';

export * from './library';
export { getSwatchUrl, getTexture } from './textures';

/** Rendering description of a material key (library id, custom paint, or generator key). */
export interface MaterialSpec {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  def: MaterialDef;
}

/** Resolves a material key to a render spec, applying any per-project override. */
export function resolveMaterial(
  key: string,
  overrides: Record<string, MaterialOverride> = {},
): MaterialSpec {
  const def = resolveDef(key);
  const o = overrides[key];
  return {
    color: o?.color ?? def.color,
    roughness: o?.roughness ?? def.roughness,
    metalness: o?.metalness ?? def.metalness,
    opacity: def.opacity ?? 1,
    def,
  };
}
