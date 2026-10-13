import { type TranslationKey, t } from '../i18n';

export type MaterialCategory = 'floor' | 'wall' | 'ceiling' | 'surface' | 'ground';

export type TextureKind =
  | 'wood-planks'
  | 'herringbone'
  | 'tiles-square'
  | 'tiles-subway'
  | 'tiles-large'
  | 'marble'
  | 'concrete'
  | 'carpet'
  | 'brick'
  | 'wood-slats'
  | 'wallpaper-stripes'
  | 'wallpaper-damask'
  | 'wallpaper-dots'
  | 'laminate'
  | 'metal-brushed'
  | 'grass'
  | 'water'
  | 'paving-stone'
  | 'decking'
  | 'gravel'
  | 'pool-tile';

export interface MaterialDef {
  id: string;
  nameKey: TranslationKey;
  /** The user's own name for an uploaded texture (shown instead of the translated `nameKey`). */
  name?: string;
  /** An uploaded picture used as the texture (instead of a painted `texture` kind). */
  textureUrl?: string;
  /** Where the picker offers it. The first entry is its main category. */
  categories: MaterialCategory[];
  /** Base color (also the flat color when no texture, and the swatch fallback). */
  color: string;
  /** Procedural texture painted on a canvas; `undefined` = plain color. */
  texture?: TextureKind;
  /** Second color used by the texture (grout, grain, stripe …). */
  accent?: string;
  /** Real-world size in meters covered by ONE repeat of the texture image — this is what keeps tiles the same size everywhere. */
  textureScale: number;
  roughness: number;
  metalness: number;
  opacity?: number;
}

const def = (d: MaterialDef): MaterialDef => d;

/** Every material the user can pick, in picker order. */
export const MATERIALS: MaterialDef[] = [
  // ── Paint ──
  def({
    id: 'paint-white',
    nameKey: 'mat.paint-white',
    categories: ['wall', 'ceiling'],
    // No surface reflects 100 %: whites are warm or cool off-whites (albedo ≤ 0.9), so white furniture stays readable.
    color: '#ebe8e1',
    textureScale: 1,
    roughness: 0.92,
    metalness: 0,
  }),
  def({
    id: 'paint-cool-white',
    nameKey: 'mat.paint-cool-white',
    categories: ['wall', 'ceiling'],
    color: '#e3e8ec',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-oak-white',
    nameKey: 'mat.paint-oak-white',
    categories: ['wall', 'ceiling'],
    color: '#e8dfcf',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-cream',
    nameKey: 'mat.paint-cream',
    categories: ['wall', 'ceiling'],
    color: '#f3e9d2',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-grey',
    nameKey: 'mat.paint-grey',
    categories: ['wall', 'ceiling'],
    color: '#b8bcc2',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-sage',
    nameKey: 'mat.paint-sage',
    categories: ['wall', 'ceiling'],
    color: '#aebfa6',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-blue',
    nameKey: 'mat.paint-blue',
    categories: ['wall', 'ceiling'],
    color: '#a9c2d6',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-terracotta',
    nameKey: 'mat.paint-terracotta',
    categories: ['wall'],
    color: '#c8826a',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'paint-charcoal',
    nameKey: 'mat.paint-charcoal',
    categories: ['wall'],
    color: '#4b5058',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  // ── Wall coverings ──
  def({
    id: 'brick-red',
    nameKey: 'mat.brick-red',
    categories: ['wall'],
    color: '#a8553a',
    accent: '#d8d2c8',
    texture: 'brick',
    textureScale: 0.78,
    roughness: 0.95,
    metalness: 0,
  }),
  def({
    id: 'brick-white',
    nameKey: 'mat.brick-white',
    categories: ['wall'],
    color: '#ece8e0',
    accent: '#c9c3b8',
    texture: 'brick',
    textureScale: 0.78,
    roughness: 0.95,
    metalness: 0,
  }),
  def({
    id: 'concrete',
    nameKey: 'mat.concrete',
    categories: ['wall', 'ceiling'],
    color: '#9ca3af',
    accent: '#7b838f',
    texture: 'concrete',
    textureScale: 1.2,
    roughness: 0.95,
    metalness: 0,
  }),
  def({
    id: 'wood-panel',
    nameKey: 'mat.wood-panel',
    categories: ['wall'],
    color: '#a9794d',
    accent: '#8a5f3a',
    texture: 'wood-slats',
    textureScale: 0.6,
    roughness: 0.7,
    metalness: 0,
  }),
  def({
    id: 'tile-white',
    nameKey: 'mat.tile-subway-wall',
    categories: ['wall'],
    color: '#eef1f3',
    accent: '#c4cbd0',
    texture: 'tiles-subway',
    textureScale: 0.6,
    roughness: 0.3,
    metalness: 0,
  }),
  def({
    id: 'wallpaper-stripes',
    nameKey: 'mat.wallpaper-stripes',
    categories: ['wall'],
    color: '#e9e2d0',
    accent: '#b9a87f',
    texture: 'wallpaper-stripes',
    textureScale: 0.5,
    roughness: 0.85,
    metalness: 0,
  }),
  def({
    id: 'wallpaper-damask',
    nameKey: 'mat.wallpaper-damask',
    categories: ['wall'],
    color: '#d9dfe6',
    accent: '#8b9db3',
    texture: 'wallpaper-damask',
    textureScale: 0.6,
    roughness: 0.85,
    metalness: 0,
  }),
  def({
    id: 'wallpaper-dots',
    nameKey: 'mat.wallpaper-dots',
    categories: ['wall'],
    color: '#f2e3e0',
    accent: '#d58f8a',
    texture: 'wallpaper-dots',
    textureScale: 0.4,
    roughness: 0.85,
    metalness: 0,
  }),
  def({
    id: 'marble-wall',
    nameKey: 'mat.marble',
    categories: ['wall', 'floor'],
    color: '#ecebe8',
    accent: '#8c8f96',
    texture: 'marble',
    textureScale: 1.6,
    roughness: 0.25,
    metalness: 0,
  }),
  // ── Outdoors (site zones) ──
  def({
    id: 'grass',
    nameKey: 'mat.grass',
    categories: ['ground'],
    color: '#4d8f3a',
    accent: '#3b7a2c',
    texture: 'grass',
    textureScale: 2,
    roughness: 1,
    metalness: 0,
  }),
  def({
    id: 'water',
    nameKey: 'mat.water',
    categories: ['ground'],
    color: '#2aa7d6',
    accent: '#7fd6f0',
    texture: 'water',
    textureScale: 2,
    roughness: 0.05,
    metalness: 0.1,
    opacity: 0.78,
  }),
  def({
    id: 'paving-stone',
    nameKey: 'mat.paving-stone',
    categories: ['ground', 'floor'],
    color: '#8c8f94',
    accent: '#6b6e73',
    texture: 'paving-stone',
    textureScale: 1.2,
    roughness: 0.85,
    metalness: 0,
  }),
  def({
    id: 'decking',
    nameKey: 'mat.decking',
    categories: ['ground', 'floor'],
    color: '#9a6a3f',
    accent: '#7a502d',
    texture: 'decking',
    textureScale: 1.2,
    roughness: 0.7,
    metalness: 0,
  }),
  def({
    id: 'gravel',
    nameKey: 'mat.gravel',
    categories: ['ground'],
    color: '#b9b2a3',
    accent: '#8f887a',
    texture: 'gravel',
    textureScale: 1,
    roughness: 1,
    metalness: 0,
  }),
  def({
    id: 'pool-tile',
    nameKey: 'mat.pool-tile',
    categories: ['ground', 'floor'],
    color: '#2f9fc9',
    accent: '#e6f6fb',
    texture: 'pool-tile',
    textureScale: 0.9,
    roughness: 0.3,
    metalness: 0,
  }),
  // ── Floors ──
  def({
    id: 'floor-oak',
    nameKey: 'mat.floor-oak',
    categories: ['floor'],
    color: '#c69c6d',
    accent: '#a57c50',
    texture: 'wood-planks',
    textureScale: 1.2,
    roughness: 0.6,
    metalness: 0,
  }),
  def({
    id: 'floor-walnut',
    nameKey: 'mat.floor-walnut',
    categories: ['floor'],
    color: '#6b4a33',
    accent: '#4a3222',
    texture: 'wood-planks',
    textureScale: 1.2,
    roughness: 0.6,
    metalness: 0,
  }),
  def({
    id: 'floor-herringbone',
    nameKey: 'mat.floor-herringbone',
    categories: ['floor'],
    color: '#b98d5c',
    accent: '#8f6a41',
    texture: 'herringbone',
    textureScale: 0.96,
    roughness: 0.6,
    metalness: 0,
  }),
  def({
    id: 'floor-tile-grey',
    nameKey: 'mat.floor-tile-grey',
    categories: ['floor'],
    color: '#9aa1a8',
    accent: '#6f757b',
    texture: 'tiles-square',
    textureScale: 1.2,
    roughness: 0.4,
    metalness: 0,
  }),
  def({
    id: 'floor-tile-white',
    nameKey: 'mat.floor-tile-white',
    categories: ['floor'],
    color: '#dfe3e6',
    accent: '#aeb4b9',
    texture: 'tiles-square',
    textureScale: 1.2,
    roughness: 0.35,
    metalness: 0,
  }),
  def({
    id: 'floor-tile-subway',
    nameKey: 'mat.floor-tile-subway',
    categories: ['floor'],
    color: '#e8ebee',
    accent: '#b5bcc2',
    texture: 'tiles-subway',
    textureScale: 0.6,
    roughness: 0.35,
    metalness: 0,
  }),
  def({
    id: 'floor-tile-large',
    nameKey: 'mat.floor-tile-large',
    categories: ['floor'],
    color: '#c9c5bd',
    accent: '#a09b92',
    texture: 'tiles-large',
    textureScale: 1.2,
    roughness: 0.3,
    metalness: 0,
  }),
  def({
    id: 'floor-marble',
    nameKey: 'mat.marble',
    categories: ['floor'],
    color: '#eceae6',
    accent: '#7d8088',
    texture: 'marble',
    textureScale: 1.6,
    roughness: 0.2,
    metalness: 0,
  }),
  def({
    id: 'floor-concrete',
    nameKey: 'mat.floor-concrete',
    categories: ['floor'],
    color: '#8f969c',
    accent: '#757c83',
    texture: 'concrete',
    textureScale: 1.2,
    roughness: 0.95,
    metalness: 0,
  }),
  def({
    id: 'floor-carpet-grey',
    nameKey: 'mat.floor-carpet-grey',
    categories: ['floor'],
    color: '#7c838a',
    accent: '#6a7077',
    texture: 'carpet',
    textureScale: 0.5,
    roughness: 1,
    metalness: 0,
  }),
  def({
    id: 'floor-carpet-beige',
    nameKey: 'mat.floor-carpet-beige',
    categories: ['floor'],
    color: '#c9b79c',
    accent: '#b4a285',
    texture: 'carpet',
    textureScale: 0.5,
    roughness: 1,
    metalness: 0,
  }),
  // ── Furniture / fixtures surfaces ──
  def({
    id: 'laminate-white',
    nameKey: 'mat.laminate-white',
    categories: ['surface'],
    color: '#ecece9',
    accent: '#d9d9d5',
    texture: 'laminate',
    textureScale: 0.6,
    roughness: 0.4,
    metalness: 0,
  }),
  def({
    id: 'laminate-oak',
    nameKey: 'mat.laminate-oak',
    categories: ['surface'],
    color: '#c9a67a',
    accent: '#a98558',
    texture: 'laminate',
    textureScale: 0.6,
    roughness: 0.5,
    metalness: 0,
  }),
  def({
    id: 'laminate-grey',
    nameKey: 'mat.laminate-grey',
    categories: ['surface'],
    color: '#8a9096',
    accent: '#737980',
    texture: 'laminate',
    textureScale: 0.6,
    roughness: 0.45,
    metalness: 0,
  }),
  def({
    id: 'wood-walnut-surface',
    nameKey: 'mat.floor-walnut',
    categories: ['surface'],
    color: '#6b4a33',
    accent: '#4a3222',
    texture: 'wood-planks',
    textureScale: 0.8,
    roughness: 0.55,
    metalness: 0,
  }),
  def({
    id: 'marble-surface',
    nameKey: 'mat.marble',
    categories: ['surface'],
    color: '#eceae6',
    accent: '#7d8088',
    texture: 'marble',
    textureScale: 1.2,
    roughness: 0.2,
    metalness: 0,
  }),
  def({
    id: 'metal-brushed',
    nameKey: 'mat.metal-brushed',
    categories: ['surface'],
    color: '#b9bec5',
    accent: '#9aa0a8',
    texture: 'metal-brushed',
    textureScale: 0.5,
    roughness: 0.4,
    metalness: 0.85,
  }),
  def({
    id: 'metal-black',
    nameKey: 'mat.metal-black',
    categories: ['surface'],
    color: '#2b2f36',
    textureScale: 1,
    roughness: 0.45,
    metalness: 0.7,
  }),
  def({
    id: 'glass',
    nameKey: 'mat.glass',
    categories: ['surface'],
    color: '#a5d8ff',
    textureScale: 1,
    roughness: 0.05,
    metalness: 0,
    opacity: 0.35,
  }),
];

/** Fixed keys used by the generators; not offered in pickers. */
const INTERNAL: MaterialDef[] = [
  def({
    id: 'wall-edge',
    nameKey: 'mat.paint-white',
    categories: [],
    color: '#d6d3d1',
    textureScale: 1,
    roughness: 0.85,
    metalness: 0,
  }),
  def({
    id: 'slab',
    nameKey: 'mat.concrete',
    categories: [],
    color: '#bfc3c8',
    textureScale: 1,
    roughness: 0.95,
    metalness: 0,
  }),
  def({
    id: 'ceiling',
    nameKey: 'mat.paint-white',
    categories: [],
    color: '#ecebe6',
    textureScale: 1,
    roughness: 0.85,
    metalness: 0,
  }),
  def({
    id: 'roof',
    nameKey: 'mat.concrete',
    categories: [],
    color: '#6b7280',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'column',
    nameKey: 'mat.concrete',
    categories: [],
    color: '#9ca3af',
    textureScale: 1,
    roughness: 0.9,
    metalness: 0,
  }),
  def({
    id: 'stair',
    nameKey: 'mat.floor-oak',
    categories: [],
    color: '#cfa77a',
    textureScale: 1,
    roughness: 0.65,
    metalness: 0,
  }),
  def({
    id: 'rail',
    nameKey: 'mat.metal-black',
    categories: [],
    color: '#374151',
    textureScale: 1,
    roughness: 0.5,
    metalness: 0.4,
  }),
  def({
    id: 'frame',
    nameKey: 'mat.paint-white',
    categories: [],
    color: '#e5e7eb',
    textureScale: 1,
    roughness: 0.5,
    metalness: 0,
  }),
  def({
    id: 'leaf',
    nameKey: 'mat.floor-oak',
    categories: [],
    color: '#b9814e',
    textureScale: 1,
    roughness: 0.6,
    metalness: 0,
  }),
];

const byId = new Map<string, MaterialDef>([...INTERNAL, ...MATERIALS].map((m) => [m.id, m]));

export const getMaterialDef = (id: string): MaterialDef | undefined => byId.get(id);

export const materialsForCategory = (category: MaterialCategory): MaterialDef[] =>
  MATERIALS.filter((m) => m.categories.includes(category));

/** The user's uploaded textures (they can go on any surface). */
export const customTextureDefs = (): MaterialDef[] => [...customTextures.values()];

/** Name of a material as shown to the user: the user's own name for uploaded textures, else the translation. */
export const materialDefName = (d: MaterialDef, tr: (key: TranslationKey) => string = t): string =>
  d.name ?? tr(d.nameKey);

/** The user's uploaded textures (id `tex:<asset id>`), filled from the server's asset list. */
const customTextures = new Map<string, MaterialDef>();
let customVersion = 0;

/** Changes whenever the set of uploaded textures changes (caches of materials built from them must refresh). */
export const customTextureVersion = (): number => customVersion;

export function registerCustomTextures(
  list: { id: string; name: string; url: string; scale: number }[],
): void {
  customTextures.clear();
  for (const x of list) {
    customTextures.set(
      x.id,
      def({
        id: x.id,
        nameKey: 'mat.unknown',
        name: x.name,
        textureUrl: x.url,
        categories: ['floor', 'wall', 'ceiling', 'surface', 'ground'],
        color: '#ffffff',
        textureScale: x.scale,
        roughness: 0.85,
        metalness: 0,
      }),
    );
  }
  customVersion++;
}

/** Custom paint: `paint:#rrggbb` is any colour of wall/ceiling paint. */
export const PAINT_PREFIX = 'paint:';
export const customPaint = (hex: string): string => `${PAINT_PREFIX}${hex.toLowerCase()}`;
export const isCustomPaint = (id: string): boolean => /^paint:#[0-9a-f]{6}$/i.test(id);
export const customPaintColor = (id: string): string => id.slice(PAINT_PREFIX.length);

/** Material definition for any id the model may contain (library, custom paint, or an unknown id → flat grey). */
export function resolveDef(id: string): MaterialDef {
  const known = byId.get(id) ?? customTextures.get(id);
  if (known) return known;
  if (isCustomPaint(id)) {
    return def({
      id,
      nameKey: 'mat.paint-custom',
      categories: ['wall', 'ceiling'],
      color: customPaintColor(id),
      textureScale: 1,
      roughness: 0.9,
      metalness: 0,
    });
  }
  return def({
    id,
    nameKey: 'mat.unknown',
    categories: [],
    color: '#cbd5e1',
    textureScale: 1,
    roughness: 0.8,
    metalness: 0,
  });
}
