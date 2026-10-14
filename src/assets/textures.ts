import {
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';

/** PBR texture sets of the asset pack, by the library material they replace. */
export interface PackTexture {
  id: string;
  materialId: string;
  /** Metres covered by one repeat. */
  scale: number;
  albedo: string;
  normal?: string;
  roughness?: string;
  ao?: string;
  /** A colour the albedo is multiplied by (a white tile used as blue pool tile). */
  tint?: string;
}

export interface PbrMaps {
  map: Texture;
  normalMap?: Texture;
  roughnessMap?: Texture;
  aoMap?: Texture;
  tint?: string;
}

const sets = new Map<string, PackTexture>();
const loaded = new Map<string, PbrMaps>();
let version = 0;

export const setPackTextures = (list: PackTexture[]): void => {
  sets.clear();
  loaded.clear();
  for (const t of list) sets.set(t.materialId, t);
  version++;
};
export const clearPackTextures = (): void => {
  sets.clear();
  loaded.clear();
  version++;
};
export const packTexturesVersion = (): number => version;
export const hasPackTexture = (materialId: string): boolean => sets.has(materialId);

function texture(url: string, scale: number, srgb: boolean): Texture | null {
  try {
    const t = new TextureLoader().load(url);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(1 / scale, 1 / scale);
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = 8;
    return t;
  } catch {
    return null; // no image support (tests)
  }
}

/** The texture maps of a material (loaded in the background; the surface updates when they arrive), or null. */
export function packMapsFor(materialId: string): PbrMaps | null {
  const s = sets.get(materialId);
  if (!s) return null;
  let m = loaded.get(materialId);
  if (!m) {
    const map = texture(s.albedo, s.scale, true);
    if (!map) return null;
    m = {
      map,
      normalMap: (s.normal && texture(s.normal, s.scale, false)) || undefined,
      roughnessMap: (s.roughness && texture(s.roughness, s.scale, false)) || undefined,
      aoMap: (s.ao && texture(s.ao, s.scale, false)) || undefined,
      tint: s.tint,
    };
    loaded.set(materialId, m);
  }
  return m;
}
