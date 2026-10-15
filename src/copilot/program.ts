import type { BriefFeature, BriefRoom, DesignBrief, RoomType } from '../model/types';

/** Typical floor areas (m²) the copilot proposes when a person names a room but not its size. */
export const DEFAULT_AREA: Partial<Record<RoomType, number>> = {
  living: 24,
  dining: 12,
  kitchen: 12,
  bedroom: 12,
  bathroom: 5,
  study: 9,
  utility: 5,
  laundry: 5,
  pantry: 4,
  foyer: 8,
  'walk-in-closet': 6,
  gym: 16,
  sauna: 5,
  spa: 9,
  'game-room': 18,
  'home-theatre': 18,
  garage: 26,
  prayer: 6,
  balcony: 5,
  'outdoor-dining': 12,
  other: 10,
};

/** Display names for room types (the brief's rooms are named in English; the UI shows them as written). */
export const TYPE_NAME: Partial<Record<RoomType, string>> = {
  living: 'Living room',
  dining: 'Dining',
  kitchen: 'Kitchen',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  study: 'Study',
  utility: 'Utility',
  laundry: 'Laundry',
  pantry: 'Pantry',
  foyer: 'Foyer',
  'walk-in-closet': 'Walk-in closet',
  gym: 'Gym',
  sauna: 'Sauna',
  spa: 'Spa',
  'game-room': 'Game room',
  'home-theatre': 'Home theatre',
  garage: 'Garage',
  prayer: 'Prayer room',
  balcony: 'Balcony',
  'outdoor-dining': 'Outdoor dining',
  other: 'Room',
};

let serial = 0;
/** A short unique id for a brief room. */
export const roomId = (): string => `r${Date.now().toString(36)}${(serial++).toString(36)}`;

export interface RoomOpts {
  name?: string;
  area?: number;
  level?: number | null;
  priority?: BriefRoom['priority'];
  next?: string[];
  locked?: boolean;
  light?: boolean;
}

/** A brief room with sensible defaults for its type. */
export function makeRoom(type: RoomType, opts: RoomOpts = {}): BriefRoom {
  return {
    id: roomId(),
    type,
    name: opts.name ?? TYPE_NAME[type] ?? 'Room',
    area: opts.area ?? DEFAULT_AREA[type] ?? 10,
    level: opts.level ?? null,
    priority: opts.priority ?? 'must',
    next: opts.next ?? [],
    locked: opts.locked ?? false,
    light:
      opts.light ?? !['bathroom', 'utility', 'laundry', 'pantry', 'sauna', 'garage'].includes(type),
  };
}

export const FEATURE_DEFAULTS: Record<string, Pick<BriefFeature, 'side' | 'covered'>> = {
  pool: { side: 'back', covered: false },
  deck: { side: 'back', covered: false },
  garden: { side: 'front', covered: false },
  lawn: { side: 'back', covered: false },
  parking: { side: 'front', covered: true },
  patio: { side: 'back', covered: true },
  play: { side: 'left', covered: false },
  'water-feature': { side: 'front', covered: false },
};

export const makeFeature = (
  type: BriefFeature['type'],
  over: Partial<BriefFeature> = {},
): BriefFeature => ({
  type,
  side: FEATURE_DEFAULTS[type]?.side ?? 'back',
  covered: FEATURE_DEFAULTS[type]?.covered ?? false,
  priority: 'must',
  size: 1,
  ...over,
});

export interface ProgramWish {
  bedrooms: number;
  bathrooms: number;
  levels: number;
  villa: boolean;
  /** Every bedroom gets its own bathroom. */
  ensuite: boolean;
  open: boolean;
  extras: {
    type: RoomType;
    name?: string;
    area?: number;
    level?: number | null;
    priority?: BriefRoom['priority'];
  }[];
  /** A bedroom on the ground floor with its own bathroom (for parents, a guest). */
  groundBedroom?: { name: string };
  closet: boolean;
}

/**
 * The room list a wish implies: living, kitchen, dining, the bedrooms with their bathrooms beside them, then the
 * extras. Sizes follow the count of bedrooms (bigger homes get bigger living rooms).
 */
export function defaultProgram(w: ProgramWish): BriefRoom[] {
  const rooms: BriefRoom[] = [];
  const big = w.bedrooms >= 4 || w.villa;
  rooms.push(
    makeRoom('living', { area: big ? 32 : 24, next: w.open ? ['Kitchen'] : [] }),
    makeRoom('kitchen', { area: big ? 16 : 12, next: ['Dining'] }),
    makeRoom('dining', { area: big ? 14 : 10 }),
  );
  if (w.villa) rooms.unshift(makeRoom('foyer', { area: 9 }));
  let baths = Math.max(1, w.bathrooms);
  const bedNames: string[] = [];
  for (let i = 0; i < w.bedrooms; i++) {
    const name = i === 0 ? 'Master bedroom' : `Bedroom ${i + 1}`;
    bedNames.push(name);
    const attached = i === 0 || w.ensuite || baths >= w.bedrooms - i;
    const bathName = i === 0 ? 'Master bath' : `Bath ${i + 1}`;
    const next: string[] = [];
    if (attached && baths > 0) {
      next.push(bathName);
      baths--;
    }
    if (i === 0 && w.closet) next.push('Walk-in closet');
    rooms.push(
      makeRoom('bedroom', { name, area: i === 0 ? (big ? 20 : 16) : big ? 14 : 12, next }),
    );
    if (next.includes(bathName))
      rooms.push(makeRoom('bathroom', { name: bathName, area: i === 0 ? 7 : 5.5, next: [name] }));
  }
  if (w.closet)
    rooms.push(
      makeRoom('walk-in-closet', { name: 'Walk-in closet', area: 6, next: ['Master bedroom'] }),
    );
  if (w.groundBedroom) {
    const n = w.groundBedroom.name;
    rooms.push(
      makeRoom('bedroom', { name: n, area: 14, level: 0, next: [`${n} bath`] }),
      makeRoom('bathroom', { name: `${n} bath`, area: 5, level: 0, next: [n] }),
    );
  }
  // Remaining bathrooms: a guest bath, then family baths.
  let extra = 0;
  while (baths > 0) {
    extra++;
    rooms.push(
      makeRoom('bathroom', {
        name:
          extra === 1 && w.levels > 1 ? 'Guest bath' : `Family bath${extra > 1 ? ` ${extra}` : ''}`,
        area: 4.5,
        level: extra === 1 && w.levels > 1 ? 0 : null,
      }),
    );
    baths--;
  }
  for (const e of w.extras)
    rooms.push(
      makeRoom(e.type, {
        name: e.name,
        area: e.area,
        level: e.level ?? null,
        priority: e.priority ?? 'must',
      }),
    );
  return rooms;
}

/** The brief with no rooms or wishes yet. */
export function emptyBrief(over: Partial<DesignBrief> = {}): DesignBrief {
  return {
    language: 'en',
    levels: 1,
    kind: 'duplex',
    program: [],
    features: [],
    cars: 0,
    style: { keywords: [], palette: [] },
    budget: 'mid',
    priorities: [],
    hints: {},
    assumptions: [],
    ...over,
  };
}

/** Bedrooms a building of this floor area (all levels, m²) comfortably holds. */
export const bedroomsForArea = (area: number): number =>
  Math.max(1, Math.min(6, Math.round(area / 55)));

/**
 * A building size was chosen but the number of bedrooms was only assumed: the bedrooms follow the size (a large
 * building does not get two giant bedrooms), each with its bathroom, and the living areas grow a little.
 */
export function fitProgramToSize(brief: DesignBrief): DesignBrief {
  const s = brief.size;
  if (!s || s.of !== 'building' || !brief.assumptions.some((a) => a.key === 'bedrooms'))
    return brief;
  const target = bedroomsForArea(s.width * s.depth * Math.max(1, brief.levels));
  const have = brief.program.filter(
    (r) => r.type === 'bedroom' && !/guest|parent|mother|father|elder|grand/i.test(r.name),
  ).length;
  if (have === target) return brief;
  const next = structuredClone(brief);
  for (let i = have; i < target; i++) {
    const name = `Bedroom ${i + 1}`;
    next.program.push(
      makeRoom('bedroom', { name, next: [`Bath ${i + 1}`] }),
      makeRoom('bathroom', { name: `Bath ${i + 1}`, area: 5, next: [name] }),
    );
  }
  for (let i = have; i > target; i--) {
    const last = [...next.program]
      .reverse()
      .find((r) => r.type === 'bedroom' && /^Bedroom \d+$/.test(r.name));
    if (!last) break;
    next.program = next.program.filter(
      (r) => r.id !== last.id && !(r.type === 'bathroom' && last.next.includes(r.name)),
    );
  }
  next.assumptions = next.assumptions.map((a) =>
    a.key === 'bedrooms' ? { ...a, text: `${target} bedrooms for this size` } : a,
  );
  return next;
}

/**
 * A brief that came from an interview or a few chips has some rooms and wishes but no living room or kitchen yet:
 * the rooms every home needs are added (the bedrooms asked for are kept; their count follows the household and levels).
 */
export function ensureProgram(brief: DesignBrief): DesignBrief {
  const has = (t: RoomType) => brief.program.some((r) => r.type === t);
  if (has('living') && has('kitchen')) return brief;
  const regular = brief.program.filter(
    (r) => r.type === 'bedroom' && !/guest|parent|mother|father|elder|grand/i.test(r.name),
  ).length;
  const h = brief.household;
  const wanted =
    regular ||
    (h
      ? Math.max(
          2,
          Math.min(5, Math.ceil(((h.adults ?? 2) + (h.children ?? 0)) / 2) + (h.children ? 1 : 0)),
        )
      : Math.max(2, brief.levels + 1, brief.kind === 'villa' ? 3 : 2));
  const base = defaultProgram({
    bedrooms: regular ? 0 : wanted,
    bathrooms: regular ? 0 : wanted > 3 ? wanted - 1 : Math.min(2, wanted),
    levels: brief.levels,
    villa: brief.kind === 'villa',
    ensuite: false,
    open: brief.priorities.includes('open-plan'),
    extras: [],
    closet: brief.budget === 'luxury' && !regular,
  }).filter(
    (r) =>
      !brief.program.some(
        (e) => e.type === r.type && ['living', 'kitchen', 'dining', 'foyer'].includes(r.type),
      ),
  );
  const note = regular ? undefined : { key: 'bedrooms', text: `${wanted} bedrooms` };
  return {
    ...brief,
    program: [...base, ...brief.program],
    assumptions: [
      ...brief.assumptions,
      ...(note ? [note] : []),
      { key: 'core', text: 'Living room, kitchen and dining added' },
    ],
  };
}
