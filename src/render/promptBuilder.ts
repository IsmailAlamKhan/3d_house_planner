import { en } from '../i18n/en';
import type { PresentLook, PresentPreset } from '../present/presets';
import type { Project, RoomType } from '../model/types';

export type StylePresetId =
  'modern-luxury' | 'warm-minimal' | 'classic' | 'tropical' | 'industrial';

export const STYLE_PRESETS: { id: StylePresetId; keywords: string }[] = [
  {
    id: 'modern-luxury',
    keywords:
      'luxury modern interior, high-end designer furniture, soft indirect lighting, elegant, refined materials',
  },
  {
    id: 'warm-minimal',
    keywords: 'warm minimalist interior, natural oak wood, linen fabrics, calm, uncluttered, cozy',
  },
  {
    id: 'classic',
    keywords:
      'classic elegant interior, wall moldings, rich fabrics, traditional furniture, timeless',
  },
  {
    id: 'tropical',
    keywords: 'tropical interior, lush indoor plants, rattan, bamboo, bright and airy, resort feel',
  },
  {
    id: 'industrial',
    keywords: 'industrial loft interior, exposed concrete, black metal accents, leather, urban',
  },
];

const VIEW: Record<PresentPreset, string> = {
  'cutaway-top':
    'top-down architectural cutaway render of a home floor plan, no roof, seen from directly above',
  'cutaway-34':
    'three-quarter view architectural cutaway render of a home, no roof, seen from above at an angle',
  eye: 'interior architectural photograph, eye-level view',
};

const LIGHT: Record<PresentLook, string> = {
  dusk: 'warm dusk lighting, glowing warm interior lamps, blue hour',
  daylight: 'soft natural daylight, bright and airy',
  night: 'night scene, warm glowing interior lamps, moody',
};

const ROOM_WORDS: Partial<Record<RoomType, string>> = {
  living: 'living room',
  kitchen: 'kitchen',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  dining: 'dining area',
  study: 'study',
  utility: 'utility room',
  balcony: 'balcony',
  foyer: 'foyer',
  'walk-in-closet': 'walk-in closet',
  gym: 'home gym',
  sauna: 'sauna',
  spa: 'spa',
  'game-room': 'game room',
  garage: 'garage',
  laundry: 'laundry',
  pantry: 'pantry',
  'home-theatre': 'home theatre',
  prayer: 'prayer room',
  'outdoor-dining': 'outdoor dining',
  outdoor: 'terrace',
};

/** `mat.floor-oak` → "oak" style words from the English material names. */
function materialWords(id: string): string | null {
  if (id.startsWith('paint:')) return null;
  const name = (en as Record<string, string>)[`mat.${id}`];
  return name ? name.toLowerCase() : null;
}

const top = <T>(counts: Map<T, number>, n: number): T[] =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);

export interface PromptInput {
  project: Project;
  preset: PresentPreset | null;
  look: PresentLook;
  style: StylePresetId;
  /** Only rooms of these levels (the ones in the picture); null = all. */
  levelIds?: ReadonlySet<string> | null;
}

export const NEGATIVE_PROMPT =
  'text, letters, words, watermark, logo, labels, captions, distorted furniture, warped walls, extra walls, ' +
  'duplicate rooms, floating objects, blurry, low quality, jpeg artifacts, deformed, oversaturated';

/** A descriptive starting prompt from the design (view, light, rooms, key materials, style); the user can edit it. */
export function buildPrompt(input: PromptInput): { prompt: string; negative: string } {
  const { project } = input;
  const rooms = project.rooms.filter(
    (r) => r.name !== 'Open to below' && (!input.levelIds || input.levelIds.has(r.levelId)),
  );
  const roomKinds = new Map<string, number>();
  const floors = new Map<string, number>();
  const walls = new Map<string, number>();
  for (const r of rooms) {
    const w = ROOM_WORDS[r.type];
    if (w) roomKinds.set(w, (roomKinds.get(w) ?? 0) + 1);
    const f = materialWords(r.floorMaterial);
    if (f) floors.set(f, (floors.get(f) ?? 0) + 1);
  }
  for (const wall of project.walls) {
    const m = materialWords(wall.materialInside);
    if (m && m !== 'white paint') walls.set(m, (walls.get(m) ?? 0) + 1);
  }
  const style = STYLE_PRESETS.find((s) => s.id === input.style) ?? STYLE_PRESETS[0]!;
  const parts = [
    style.keywords,
    VIEW[input.preset ?? 'cutaway-34'],
    LIGHT[input.look],
    roomKinds.size ? `rooms: ${top(roomKinds, 7).join(', ')}` : '',
    floors.size ? `${top(floors, 2).join(' and ')} flooring` : '',
    walls.size ? `${top(walls, 2).join(' and ')} walls` : '',
    project.site.zones.some((z) => z.type === 'pool') ? 'swimming pool, landscaped garden' : '',
    'lush indoor plants, styled decor, highly detailed, photorealistic, sharp focus',
  ];
  return { prompt: parts.filter(Boolean).join(', '), negative: NEGATIVE_PROMPT };
}
