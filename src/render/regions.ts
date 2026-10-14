/**
 * The regions of a studio render. Blender writes an object-index pass where every pixel holds the id of the kind of
 * surface it shows (0 = sky); Enhance v2 turns each id into a mask and gives it its own prompt, so the pool turns into
 * water, the lawn into planting and the floors into marble, without moving anything.
 */
export interface Region {
  id: number;
  key: string;
  /** What the region should look like (added as masked conditioning). Empty = no region prompt. */
  prompt: string;
}

export const REGIONS: readonly Region[] = [
  {
    id: 1,
    key: 'floor',
    prompt: 'polished marble and wood floors with soft reflections and warm pools of light',
  },
  { id: 2, key: 'wall', prompt: 'clean plastered walls with subtle texture and soft shadows' },
  { id: 3, key: 'ceiling', prompt: 'smooth ceiling' },
  { id: 4, key: 'lawn', prompt: 'lush green lawn, tropical planting, flower beds, garden lights' },
  {
    id: 5,
    key: 'water',
    prompt: 'crystal clear turquoise swimming pool water with underwater lights and gentle ripples',
  },
  {
    id: 6,
    key: 'paving',
    prompt: 'natural stone paving and wooden decking, realistic material texture',
  },
  { id: 7, key: 'glass', prompt: 'clean glass windows with subtle reflections' },
  { id: 8, key: 'car', prompt: 'glossy car paint with soft reflections, realistic cars' },
  {
    id: 9,
    key: 'soft',
    prompt: 'soft furnishings, plump bedding and sofa cushions with fabric texture, folded throws',
  },
  { id: 10, key: 'plant', prompt: 'lush tropical plants and palm trees with detailed leaves' },
  { id: 11, key: 'furniture', prompt: 'well-made designer furniture with fine wood grain' },
  { id: 12, key: 'stair', prompt: '' },
] as const;

const BY_KEY = new Map(REGIONS.map((r) => [r.key, r.id]));
export const regionId = (key: string): number => BY_KEY.get(key) ?? 11;

/** The region of a furniture or fixture item, from its catalogue id. */
export function regionOfItem(catalogId: string): string {
  if (catalogId === 'car') return 'car';
  if (/^(bed-|sofa-|armchair|rug|theatre-sofa|sun-lounger|lounge-set|wall-art)/.test(catalogId))
    return 'soft';
  if (/^(plant|tree-|shrub|hedge|flower-bed|planter|planted-island|grass-patch)/.test(catalogId))
    return 'plant';
  return 'furniture';
}

/** The region of a building or site part, from its layer and material keys. */
export function regionOfPart(layer: string, materials: readonly string[]): string {
  if (materials.some((m) => m === 'glass')) return 'glass';
  // the pool: its water and its tiled basin (seen through the water) are one region
  if (materials.some((m) => m === 'water' || m === 'pool-tile')) return 'water';
  if (materials.some((m) => m.startsWith('grass'))) return 'lawn';
  switch (layer) {
    case 'wall':
    case 'column':
      return 'wall';
    case 'floor':
    case 'slab':
      return 'floor';
    case 'ceiling':
    case 'roof':
      return 'ceiling';
    case 'stair':
      return 'stair';
    case 'site':
      return 'paving';
    default:
      return 'furniture';
  }
}
