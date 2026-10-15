import type {
  BriefFeature,
  BriefRoom,
  DesignBrief,
  Point,
  Project,
  RoomType,
} from '../model/types';
import type { DesignIntent, RoomIntent, SiteZoneIntent } from '../ai/schemas';
import { DesignIntentSchema } from '../ai/schemas';
import { STYLE_PRESETS } from './styles';
import { TYPE_NAME, emptyBrief, makeFeature, makeRoom, roomId } from './program';

const key = (s: string) => s.trim().toLowerCase();

/** Rooms that live on the ground floor of a multi-storey home unless the brief says otherwise. */
const GROUND_TYPES = new Set<RoomType>([
  'living',
  'dining',
  'kitchen',
  'foyer',
  'utility',
  'laundry',
  'pantry',
  'garage',
  'gym',
  'sauna',
  'spa',
  'game-room',
  'home-theatre',
  'prayer',
  'outdoor-dining',
]);
/** A bedroom with a name like this is wanted on the ground floor (a parent who cannot climb stairs). */
const GROUND_BEDROOM = /guest|parent|mother|father|elder|grand|ground|amma|abba/i;

/** True for a bedroom that is not one of the household's regular bedrooms (a guest room, a room for parents). */
export const isSpecialBedroom = (r: { type: string; name: string }): boolean =>
  r.type === 'bedroom' && GROUND_BEDROOM.test(r.name);

/** The regular bedrooms of a brief (what "a 4-bedroom home" counts). */
export const regularBedrooms = <T extends { type: string; name: string }>(rooms: T[]): T[] =>
  rooms.filter((r) => r.type === 'bedroom' && !isSpecialBedroom(r));

const LEVEL_NAMES = ['Ground floor', 'Upper floor', 'Second floor'];

const unique = (names: string[]): string[] => {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = key(n);
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c > 1 ? `${n} ${c}` : n;
  });
};

/** The most rooms one level of the layout engine takes. */
export const MAX_ROOMS = 19;

const KEEP: RoomType[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'foyer', 'study'];
const importance = (r: BriefRoom): number =>
  (r.priority === 'must' ? 0 : 10) +
  (r.locked ? -5 : 0) +
  (KEEP.includes(r.type) ? 0 : 3) +
  (['walk-in-closet', 'pantry', 'utility', 'laundry'].includes(r.type) ? 2 : 0);

/** The rooms of one level, trimmed to what fits (sorted by importance, the order of the brief kept). */
export function capLevel(list: BriefRoom[]): BriefRoom[] {
  if (list.length <= MAX_ROOMS) return list;
  const keep = new Set([...list].sort((a, b) => importance(a) - importance(b)).slice(0, MAX_ROOMS));
  return list.filter((r) => keep.has(r));
}

/** Which level each brief room goes on (0 = ground). Explicit levels win; the rest follow their kind. */
export function allocateLevels(brief: DesignBrief): Map<string, number> {
  const out = new Map<string, number>();
  const top = Math.max(0, brief.levels - 1);
  const rooms = brief.program;
  const byName = new Map(rooms.map((r) => [key(r.name), r]));
  // Bedrooms first (they anchor their bathrooms and closets).
  const sleepers = rooms.filter((r) => r.type === 'bedroom' && r.level === null);
  let upperIndex = 0;
  for (const r of rooms) {
    if (r.level !== null) out.set(r.id, Math.min(r.level, top));
  }
  for (const r of sleepers) {
    if (brief.levels === 1) out.set(r.id, 0);
    else if (GROUND_BEDROOM.test(r.name)) out.set(r.id, 0);
    else {
      // Spread the sleeping rooms over the upper floors (all of them on one when there is only one).
      const upper = brief.levels - 1;
      out.set(r.id, upper === 1 ? 1 : 1 + (upperIndex++ % upper));
    }
  }
  for (const r of rooms) {
    if (out.has(r.id)) continue;
    if (brief.levels === 1) {
      out.set(r.id, 0);
      continue;
    }
    if (r.type === 'bathroom' || r.type === 'walk-in-closet') {
      // With its bedroom.
      const friend = [
        ...r.next,
        ...rooms.filter((o) => o.next.some((n) => key(n) === key(r.name))).map((o) => o.name),
      ]
        .map((n) => byName.get(key(n)))
        .find((o) => o && o.type === 'bedroom');
      if (friend && out.has(friend.id)) {
        out.set(r.id, out.get(friend.id)!);
        continue;
      }
      out.set(r.id, r.type === 'bathroom' ? 0 : 1);
      continue;
    }
    out.set(
      r.id,
      GROUND_TYPES.has(r.type)
        ? 0
        : r.type === 'study'
          ? rooms.length > 12
            ? 1
            : 0
          : r.type === 'balcony'
            ? top
            : 0,
    );
  }
  // Every level above the ground needs at least one room to exist.
  return out;
}

const featureToZone = (f: BriefFeature): SiteZoneIntent => ({
  type: f.type,
  name: f.name,
  side: f.side,
  covered: f.covered,
  scale: f.size !== 1 ? f.size : undefined,
});

/**
 * The Design Brief as the layout engine's input. The program is dealt to the levels, adjacency wishes become door /
 * open links, outdoor features become site zones, the style preset sets the floor and walls.
 */
export function briefToIntent(brief: DesignBrief, opts: { areaScale?: number } = {}): DesignIntent {
  const scale = opts.areaScale ?? 1;
  const levels = Math.max(1, Math.min(3, brief.levels));
  const alloc = allocateLevels(brief);
  const rooms = brief.program;
  const perLevel: BriefRoom[][] = Array.from({ length: levels }, () => []);
  for (const r of rooms) perLevel[alloc.get(r.id) ?? 0]!.push(r);
  // A level with no rooms would be an empty floor: such levels are dropped (the others keep their order).
  const filled = perLevel.filter((l) => l.length > 0);
  if (!filled.length) filled.push([]);
  perLevel.length = 0;
  // A floor holds at most MAX_ROOMS rooms: the least important go first (nice-to-haves, then storage and service).
  perLevel.push(...filled.map((l) => capLevel(l)));
  const actual = perLevel.length;
  const open = brief.priorities.includes('open-plan');
  const names = new Map<string, string>(); // brief room id → unique name on its level
  const intents: RoomIntent[][] = perLevel.slice(0, actual).map((list) => {
    const uniq = unique(list.map((r) => r.name));
    list.forEach((r, i) => names.set(r.id, uniq[i]!));
    return list.map((r, i) => {
      const myNames = uniq;
      const adjacency = r.next
        .map((n) => {
          const idx = list.findIndex((o) => key(o.name) === key(n));
          return idx >= 0 ? myNames[idx]! : null;
        })
        .filter((n): n is string => !!n)
        .map((room) => {
          const other = list.find((o) => myNames[list.indexOf(o)] === room)!;
          const kd = ['kitchen', 'dining', 'living'];
          const isOpen =
            kd.includes(r.type) &&
            kd.includes(other.type) &&
            (open || (r.type === 'kitchen' && other.type === 'dining'));
          return { room, connection: (isOpen ? 'open' : 'door') as 'open' | 'door' };
        });
      return {
        type: r.type,
        name: myNames[i]!,
        targetArea: Math.min(120, Math.max(2, Math.round(r.area * scale * 10) / 10)),
        adjacency,
        exteriorWall:
          r.light &&
          !['bathroom', 'utility', 'laundry', 'garage', 'sauna', 'pantry'].includes(r.type)
            ? r.type === 'living' || r.type === 'bedroom'
              ? 'required'
              : 'preferred'
            : 'none',
        needsWindow:
          r.light &&
          !['bathroom', 'utility', 'laundry', 'garage', 'sauna', 'pantry'].includes(r.type)
            ? true
            : undefined,
        needsPlumbing: undefined,
        doubleHeight: undefined,
      } as RoomIntent;
    });
  });
  // The first bedroom-with-bath pairs get the adjacency both ways (the bath wants its bedroom too).
  for (const lvl of intents)
    for (const r of lvl)
      for (const a of r.adjacency) {
        const other = lvl.find((o) => o.name === a.room);
        if (other && !other.adjacency.some((x) => x.room === r.name))
          other.adjacency.push({ room: r.name, connection: a.connection });
      }
  const style = STYLE_PRESETS.find((s) => s.id === brief.style.preset);
  const zones = brief.features.filter((f) => f.type !== 'path').map(featureToZone);
  const villa = brief.kind === 'villa';
  const raw = {
    title: brief.title,
    levels: intents.map((rs, i) => ({ name: LEVEL_NAMES[i] ?? `Level ${i + 1}`, rooms: rs })),
    stair: {
      type: villa ? ('L' as const) : ('straight' as const),
      position: 'near-entrance' as const,
    },
    style: {
      floor: style?.floor ?? (brief.style.floor as NonNullable<DesignIntent['style']>['floor']),
      walls: style?.walls ?? (brief.style.walls as NonNullable<DesignIntent['style']>['walls']),
    },
    furnish: true,
    strategy: villa && actual === 1 ? ('wings' as const) : ('duplex' as const),
    site: villa || zones.length ? { zones, cars: brief.cars || undefined } : undefined,
  };
  return DesignIntentSchema.parse(raw);
}

/** Placement hints by room name (plan metres): where the person dragged each room's bubble. */
export function hintsByName(brief: DesignBrief): Record<string, Point> {
  const out: Record<string, Point> = {};
  const names = new Map<string, string>();
  const alloc = allocateLevels(brief);
  for (let li = 0; li < Math.max(1, brief.levels); li++) {
    const list = brief.program.filter((r) => (alloc.get(r.id) ?? 0) === li);
    const uniq = unique(list.map((r) => r.name));
    list.forEach((r, i) => names.set(r.id, uniq[i]!));
  }
  for (const [id, p] of Object.entries(brief.hints)) {
    const n = names.get(id);
    if (n) out[n] = p;
  }
  return out;
}

/** Names of the locked rooms (as the layout engine will name them). */
export function lockedNames(brief: DesignBrief): string[] {
  const names = new Map<string, string>();
  const alloc = allocateLevels(brief);
  for (let li = 0; li < Math.max(1, brief.levels); li++) {
    const list = brief.program.filter((r) => (alloc.get(r.id) ?? 0) === li);
    const uniq = unique(list.map((r) => r.name));
    list.forEach((r, i) => names.set(r.id, uniq[i]!));
  }
  return brief.program
    .filter((r) => r.locked)
    .map((r) => names.get(r.id)!)
    .filter(Boolean);
}

// ───────────────────────── editing the brief ─────────────────────────

/** Everything a person, a chip or the model can do to a brief. */
export type BriefOp =
  | {
      op: 'addRoom';
      type: RoomType;
      name?: string;
      area?: number;
      level?: number | null;
      next?: string[];
      priority?: 'must' | 'nice';
    }
  | { op: 'removeRoom'; room: string }
  | { op: 'resizeRoom'; room: string; area?: number; factor?: number }
  | { op: 'renameRoom'; room: string; name: string }
  | { op: 'setPriority'; room: string; priority: 'must' | 'nice' }
  | { op: 'lockRoom'; room: string; locked: boolean }
  | { op: 'setLevels'; levels: number }
  | { op: 'setKind'; kind: 'duplex' | 'villa' }
  | {
      op: 'addFeature';
      type: BriefFeature['type'];
      side?: BriefFeature['side'];
      covered?: boolean;
      name?: string;
    }
  | { op: 'removeFeature'; type: BriefFeature['type'] }
  | { op: 'resizeFeature'; type: BriefFeature['type']; factor: number }
  | { op: 'setCars'; cars: number }
  | {
      op: 'setStyle';
      preset?: string;
      keywords?: string[];
      palette?: string[];
      floor?: string;
      walls?: string;
    }
  | { op: 'setBudget'; budget: DesignBrief['budget'] }
  | { op: 'addPriority'; priority: DesignBrief['priorities'][number] }
  | { op: 'removePriority'; priority: DesignBrief['priorities'][number] }
  | { op: 'setHint'; room: string; at: Point | null }
  | { op: 'setSize'; width: number; depth: number; of: 'plot' | 'building' }
  | { op: 'setBedrooms'; count: number; ensuite?: boolean }
  | {
      op: 'setHousehold';
      adults?: number;
      children?: number;
      elderly?: number;
      guests?: boolean;
      help?: boolean;
    };

export const findRoom = (brief: DesignBrief, ref: string): BriefRoom | undefined => {
  const k = key(ref);
  return (
    brief.program.find((r) => r.id === ref) ??
    brief.program.find((r) => key(r.name) === k) ??
    brief.program.find((r) => key(r.name).includes(k) || k.includes(key(r.name))) ??
    brief.program.find((r) => r.type === (k as RoomType))
  );
};

/** Applies edits to a copy of the brief. `notes` say, in plain English, what changed (or why nothing did). */
export function applyBriefOps(
  brief: DesignBrief,
  ops: BriefOp[],
): { brief: DesignBrief; notes: string[] } {
  const b: DesignBrief = structuredClone(brief);
  const notes: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'addRoom': {
        const r = makeRoom(op.type, {
          name: op.name,
          area: op.area,
          level: op.level,
          next: op.next,
          priority: op.priority,
        });
        if (op.type === 'bedroom' && !op.name) {
          const n = b.program.filter((x) => x.type === 'bedroom').length + 1;
          r.name = `Bedroom ${n}`;
        }
        b.program.push(r);
        notes.push(`Added ${r.name} (${Math.round(r.area)} m²).`);
        break;
      }
      case 'removeRoom': {
        const r = findRoom(b, op.room);
        if (!r) {
          notes.push(`There is no "${op.room}" to remove.`);
          break;
        }
        b.program = b.program.filter((x) => x.id !== r.id);
        for (const x of b.program) x.next = x.next.filter((n) => key(n) !== key(r.name));
        delete b.hints[r.id];
        notes.push(`Removed ${r.name}.`);
        break;
      }
      case 'resizeRoom': {
        const r = findRoom(b, op.room);
        if (!r) {
          notes.push(`There is no "${op.room}" to resize.`);
          break;
        }
        const area = op.area ?? r.area * (op.factor ?? 1);
        r.area = Math.min(150, Math.max(2, Math.round(area * 10) / 10));
        notes.push(`${r.name} is now about ${Math.round(r.area)} m².`);
        break;
      }
      case 'renameRoom': {
        const r = findRoom(b, op.room);
        if (r) {
          for (const x of b.program)
            x.next = x.next.map((n) => (key(n) === key(r.name) ? op.name : n));
          r.name = op.name;
        }
        break;
      }
      case 'setPriority': {
        const r = findRoom(b, op.room);
        if (r) r.priority = op.priority;
        break;
      }
      case 'lockRoom': {
        const r = findRoom(b, op.room);
        if (r) r.locked = op.locked;
        break;
      }
      case 'setLevels':
        b.levels = Math.min(3, Math.max(1, Math.round(op.levels)));
        if (b.levels > 1)
          for (const r of b.program) if (r.level !== null && r.level >= b.levels) r.level = null;
        notes.push(`The home now has ${b.levels} ${b.levels === 1 ? 'level' : 'levels'}.`);
        break;
      case 'setKind':
        b.kind = op.kind;
        break;
      case 'addFeature': {
        if (!b.features.some((f) => f.type === op.type)) {
          b.features.push(
            makeFeature(op.type, { side: op.side, covered: op.covered, name: op.name }),
          );
          notes.push(`Added ${op.type === 'parking' ? 'parking' : op.type}.`);
        }
        if (b.kind !== 'villa') b.kind = 'villa';
        break;
      }
      case 'removeFeature':
        b.features = b.features.filter((f) => f.type !== op.type);
        if (op.type === 'parking') b.cars = 0;
        notes.push(`Removed the ${op.type}.`);
        break;
      case 'resizeFeature': {
        const f = b.features.find((x) => x.type === op.type);
        if (f) {
          f.size = Math.min(2, Math.max(0.4, f.size * op.factor));
          notes.push(`The ${op.type} will be ${op.factor < 1 ? 'smaller' : 'larger'}.`);
        } else notes.push(`There is no ${op.type} to resize.`);
        break;
      }
      case 'setCars':
        b.cars = Math.min(6, Math.max(0, op.cars));
        if (b.cars > 0 && !b.features.some((f) => f.type === 'parking')) {
          b.features.push(makeFeature('parking'));
          b.kind = 'villa';
        }
        break;
      case 'setStyle':
        if (op.preset !== undefined) b.style.preset = op.preset as DesignBrief['style']['preset'];
        if (op.keywords)
          b.style.keywords = [...new Set([...b.style.keywords, ...op.keywords])].slice(0, 12);
        if (op.palette) b.style.palette = op.palette.slice(0, 8);
        if (op.floor) b.style.floor = op.floor;
        if (op.walls) b.style.walls = op.walls;
        break;
      case 'setBudget':
        b.budget = op.budget;
        notes.push(`Budget level is now ${op.budget}.`);
        break;
      case 'addPriority':
        if (!b.priorities.includes(op.priority)) b.priorities.push(op.priority);
        break;
      case 'removePriority':
        b.priorities = b.priorities.filter((p) => p !== op.priority);
        break;
      case 'setSize':
        b.size = { width: op.width, depth: op.depth, of: op.of };
        break;
      case 'setHousehold':
        b.household = {
          adults: op.adults ?? b.household?.adults ?? 2,
          children: op.children ?? b.household?.children ?? 0,
          elderly: op.elderly ?? b.household?.elderly ?? 0,
          guests: op.guests ?? b.household?.guests ?? false,
          help: op.help ?? b.household?.help ?? false,
        };
        break;
      case 'setBedrooms': {
        const beds = regularBedrooms(b.program);
        const target = Math.min(7, Math.max(0, Math.round(op.count)));
        for (let i = beds.length; i < target; i++) {
          const name = `Bedroom ${i + 1}`;
          const bath =
            op.ensuite ?? beds.some((x) => x.next.length > 0 && x.name !== 'Master bedroom');
          b.program.push(makeRoom('bedroom', { name, next: bath ? [`Bath ${i + 1}`] : [] }));
          if (bath)
            b.program.push(makeRoom('bathroom', { name: `Bath ${i + 1}`, area: 5, next: [name] }));
        }
        for (let i = beds.length; i > target; i--) {
          const last = [...regularBedrooms(b.program)].reverse().find((r) => !r.locked);
          if (!last) break;
          b.program = b.program.filter((r) => r.id !== last.id);
          // Its own bathroom goes with it.
          for (const n of last.next) {
            const bathRoom = b.program.find((r) => r.type === 'bathroom' && key(r.name) === key(n));
            if (bathRoom && bathRoom.next.every((m) => key(m) === key(last.name)))
              b.program = b.program.filter((r) => r.id !== bathRoom.id);
          }
        }
        notes.push(`The home now has ${target} bedroom${target === 1 ? '' : 's'}.`);
        break;
      }
      case 'setHint': {
        const r = findRoom(b, op.room);
        if (r) {
          if (op.at) b.hints[r.id] = op.at;
          else delete b.hints[r.id];
        }
        break;
      }
    }
  }
  return { brief: b, notes };
}

// ───────────────────────── brief ⇄ design ─────────────────────────

/** A brief from an existing design intent (the offline generators, a template). */
export function intentToBrief(
  intent: DesignIntent,
  opts: { villa?: boolean; source?: string } = {},
): DesignBrief {
  const program: BriefRoom[] = [];
  intent.levels.forEach((lvl, li) => {
    for (const r of lvl.rooms) {
      if (r.type === 'stair' || (r.type === 'corridor' && /hall|landing|stair/i.test(r.name)))
        continue;
      program.push({
        id: roomId(),
        type: r.type,
        name: r.name,
        area: r.targetArea,
        level: intent.levels.length > 1 ? li : null,
        priority: 'must',
        next: r.adjacency.map((a) => a.room),
        locked: false,
        light: r.exteriorWall !== 'none',
      });
    }
  });
  const features: BriefFeature[] = (intent.site?.zones ?? []).map((z) =>
    makeFeature(z.type, { side: z.side, covered: z.covered ?? false, name: z.name }),
  );
  return emptyBrief({
    title: intent.title,
    levels: intent.levels.length,
    kind: opts.villa || intent.strategy === 'wings' || features.length ? 'villa' : 'duplex',
    program,
    features,
    cars: intent.site?.cars ?? 0,
    style: { keywords: [], palette: [] },
    source: opts.source,
  });
}

/** What an existing project contains, as a brief ("like this, but …" starts here). */
export function projectToBrief(project: Project): DesignBrief {
  const rooms = project.rooms.filter(
    (r) => r.type !== 'stair' && !(r.type === 'corridor' && /landing|hall/i.test(r.name)),
  );
  const levelIndex = new Map(project.levels.map((l, i) => [l.id, i]));
  const area = (poly: Point[]) =>
    Math.abs(
      poly.reduce(
        (s, p, i) =>
          s + (p.x * poly[(i + 1) % poly.length]!.y - poly[(i + 1) % poly.length]!.x * p.y),
        0,
      ),
    ) / 2;
  const seen = new Set<string>();
  const program: BriefRoom[] = [];
  for (const r of rooms) {
    if (/open to below/i.test(r.name)) continue;
    const k = `${levelIndex.get(r.levelId)}:${key(r.name)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    program.push({
      id: roomId(),
      type: r.type,
      name: r.name,
      area: Math.round(area(r.polygon) * 10) / 10,
      level: project.levels.length > 1 ? (levelIndex.get(r.levelId) ?? 0) : null,
      priority: 'must',
      next: [],
      locked: false,
      light: !['bathroom', 'utility', 'laundry', 'pantry', 'garage'].includes(r.type),
    });
  }
  const features: BriefFeature[] = project.site.zones
    .filter((z) => z.type !== 'path')
    .map((z) => makeFeature(z.type, { name: z.name, covered: z.covered }));
  const cars = project.items.filter((i) => i.catalogId === 'car').length;
  return emptyBrief({
    title: project.name,
    levels: project.levels.length,
    kind: project.kind === 'villa' ? 'villa' : 'duplex',
    program,
    features: dedupeFeatures(features),
    cars,
    style: { keywords: [], palette: [] },
  });
}

function dedupeFeatures(list: BriefFeature[]): BriefFeature[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    if (seen.has(f.type)) return false;
    seen.add(f.type);
    return true;
  });
}

/** Short English summary for the model and for logs. */
export function describeBrief(b: DesignBrief): string {
  const rooms = b.program.map(
    (r) =>
      `${r.name} ${Math.round(r.area)} m²${r.priority === 'nice' ? ' (nice to have)' : ''}${r.locked ? ' [locked]' : ''}`,
  );
  return [
    `${b.levels}-level ${b.kind}`,
    `rooms: ${rooms.join('; ') || 'none yet'}`,
    b.features.length
      ? `outdoors: ${b.features.map((f) => f.type + (f.type === 'parking' ? ` for ${b.cars || 2} cars` : '')).join(', ')}`
      : '',
    `style: ${b.style.preset ?? b.style.keywords.join(', ') ?? 'unspecified'}`,
    `budget: ${b.budget}`,
    b.priorities.length ? `cares about: ${b.priorities.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const roomLabel = (type: RoomType): string => TYPE_NAME[type] ?? type;
