import { CATALOG, entryName, getEntry, type CatalogEntry } from '../../catalog';
import { type TranslationKey, t } from '../../i18n';
import { MATERIALS, customPaint, getMaterialDef, isCustomPaint } from '../../materials';
import type { Level, Project, Room, RoomType } from '../../model/types';

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9#: ]+/g, ' ')
    .replace(/\b(the|a|an|of|my|our)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Friendly failure the UI can show as-is. */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

// ───────────── rooms & levels ─────────────

const TYPE_WORDS: Record<string, RoomType> = {
  living: 'living',
  lounge: 'living',
  kitchen: 'kitchen',
  bedroom: 'bedroom',
  bed: 'bedroom',
  bathroom: 'bathroom',
  bath: 'bathroom',
  toilet: 'bathroom',
  dining: 'dining',
  study: 'study',
  office: 'study',
  utility: 'utility',
  laundry: 'utility',
  balcony: 'balcony',
  hall: 'stair',
  corridor: 'corridor',
};

export function resolveLevel(project: Project, ref: string | undefined, fallbackId: string): Level {
  const levels = [...project.levels].sort((a, b) => a.index - b.index);
  if (!ref) return levels.find((l) => l.id === fallbackId) ?? levels[0]!;
  const r = norm(ref);
  const byName =
    levels.find((l) => norm(l.name) === r) ??
    levels.find((l) => norm(l.name).includes(r) || r.includes(norm(l.name)));
  if (byName) return byName;
  if (
    /\b(ground|first|lower|down|1st|level 1|level one|floor 1)\b/.test(r) &&
    !/\bupper|second|top\b/.test(r)
  )
    return levels[0]!;
  if (/\b(upper|second|top|up|2nd|level 2|level two|floor 2|upstairs)\b/.test(r))
    return levels[1] ?? levels[0]!;
  const n = Number(/\d+/.exec(r)?.[0]);
  if (n >= 1 && levels[n - 1]) return levels[n - 1]!;
  throw new EditError(t('ai.edit.noLevel').replace('{level}', ref));
}

/** Finds a room by name (exact, partial) or by type word ("the kitchen"), preferring the active level. */
export function resolveRoom(project: Project, ref: string, activeLevelId: string): Room {
  const r = norm(ref);
  const ordered = [...project.rooms].sort((a, b) => {
    const la =
      a.levelId === activeLevelId
        ? -1
        : (project.levels.find((l) => l.id === a.levelId)?.index ?? 0);
    const lb =
      b.levelId === activeLevelId
        ? -1
        : (project.levels.find((l) => l.id === b.levelId)?.index ?? 0);
    return la - lb;
  });
  const exact = ordered.find((x) => x.id === ref || norm(x.name) === r);
  if (exact) return exact;
  const partial = ordered.find(
    (x) =>
      norm(x.name).includes(r) ||
      (r.length > 2 && r.includes(norm(x.name)) && norm(x.name).length > 2),
  );
  if (partial) return partial;
  const type = TYPE_WORDS[r.split(' ').pop() ?? ''] ?? TYPE_WORDS[r];
  const byType = type ? ordered.find((x) => x.type === type) : undefined;
  if (byType) return byType;
  throw new EditError(
    t('ai.edit.noRoom')
      .replace('{room}', ref)
      .replace('{rooms}', project.rooms.map((x) => x.name).join(', ')),
  );
}

// ───────────── materials ─────────────

const COLORS: Record<string, string> = {
  red: '#c0392b',
  green: '#5f8f5a',
  yellow: '#e6c35c',
  orange: '#e08a3c',
  pink: '#e5a1b5',
  purple: '#8e6bb0',
  lilac: '#b9a3d6',
  brown: '#7a5a44',
  black: '#2b2b2b',
  beige: '#d9c9b0',
  navy: '#2c3e6b',
  teal: '#3f8f8f',
  mint: '#b8dcc8',
  lavender: '#c9bfe0',
  ivory: '#f4efe2',
  gold: '#c9a24d',
};

const MATERIAL_WORDS: [RegExp, string][] = [
  [/herring/, 'floor-herringbone'],
  [/walnut|dark wood|dark oak/, 'floor-walnut'],
  [/oak|wood|parquet|plank|timber/, 'floor-oak'],
  [/subway/, 'floor-tile-subway'],
  [/large.*tile|big tile/, 'floor-tile-large'],
  [/white tile/, 'floor-tile-white'],
  [/tile/, 'floor-tile-grey'],
  [/marble|stone/, 'floor-marble'],
  [/carpet|rug/, 'floor-carpet-grey'],
  [/concrete|cement/, 'floor-concrete'],
  [/brick/, 'brick-red'],
  [/wallpaper|stripe/, 'wallpaper-stripes'],
  [/charcoal|anthracite/, 'paint-charcoal'],
  [/sage/, 'paint-sage'],
  [/terracotta|clay/, 'paint-terracotta'],
  [/cream|warm white|magnolia/, 'paint-cream'],
  [/gr[ae]y/, 'paint-grey'],
  [/blue/, 'paint-blue'],
  [/white/, 'paint-white'],
];

/** Turns "oak", "sage green paint", "paint:#aabbcc" or a colour word into a material id (or null). */
export function findMaterial(query: string, target: 'floor' | 'walls' | 'ceiling'): string | null {
  const q = norm(query);
  if (!q) return null;
  const raw = query.trim().toLowerCase();
  if (getMaterialDef(raw) || isCustomPaint(raw)) return raw;
  const hex = /#[0-9a-f]{6}/.exec(raw);
  if (hex) return customPaint(hex[0]);
  const family = target === 'walls' ? 'wall' : target === 'ceiling' ? 'ceiling' : 'floor';
  // Materials whose main category is the one asked for come first (so "marble" on a floor is the floor marble).
  const ordered = MATERIALS.filter((x) => x.categories.includes(family)).sort(
    (a, b) => Number(b.categories[0] === family) - Number(a.categories[0] === family),
  );
  for (const m of ordered) {
    const name = norm(t(m.nameKey as TranslationKey));
    if (name === q || m.id.replace(/-/g, ' ') === q) return m.id;
  }
  for (const [re, id] of MATERIAL_WORDS) {
    if (re.test(q)) {
      // Floors only take floor materials, walls only wall materials: map paint words onto the right family.
      const def = getMaterialDef(id);
      if (
        def &&
        !def.categories.includes(
          target === 'walls' ? 'wall' : target === 'ceiling' ? 'ceiling' : 'floor',
        )
      ) {
        if (target === 'floor') continue;
        if (target === 'ceiling' && !id.startsWith('paint')) continue;
      }
      return id;
    }
  }
  const color = Object.keys(COLORS).find((c) => q.includes(c));
  if (color && target !== 'floor') return customPaint(COLORS[color]!);
  return null;
}

// ───────────── catalog ─────────────

const SYNONYMS: [RegExp, string][] = [
  [/couch|sofa|settee/, 'sofa-3seat'],
  [/l[ -]?shaped/, 'sofa-l'],
  [/armchair|chair.*arm|lounge chair/, 'armchair'],
  [/tv|television/, 'tv-unit'],
  [/bookcase|bookshelf|shelves|shelf/, 'bookshelf'],
  [/coffee table/, 'coffee-table'],
  [/nightstand|bedside|side table/, 'side-table'],
  [/dining table|table/, 'dining-table-4'],
  [/office chair|desk chair/, 'office-chair'],
  [/chair/, 'chair'],
  [/king/, 'bed-king'],
  [/queen/, 'bed-queen'],
  [/single bed/, 'bed-single'],
  [/bed/, 'bed-double'],
  [/wardrobe|closet/, 'wardrobe'],
  [/dresser|drawers|chest/, 'dresser'],
  [/island/, 'kitchen-island'],
  [/fridge|refrigerator/, 'fridge'],
  [/stove|hob|cooker/, 'stove'],
  [/oven/, 'oven'],
  [/sink/, 'sink-kitchen'],
  [/cabinet|cupboard/, 'kitchen-base-run'],
  [/toilet|wc/, 'wc'],
  [/basin|vanity/, 'basin'],
  [/shower/, 'shower'],
  [/bath ?tub|\btub\b|bath\b/, 'bathtub'],
  [/mirror/, 'mirror'],
  [/desk/, 'desk'],
  [/washing|washer|laundry/, 'washing-machine'],
  [/plant|flower|fern/, 'plant'],
  [/rug|carpet/, 'rug'],
  [/pendant|hanging light/, 'pendant-light'],
  [/ceiling light|downlight|light fixture/, 'ceiling-light'],
  [/lamp|light/, 'floor-lamp'],
];

/** Finds a catalog entry from an id or a free-text name ("couch", "bedside table"). */
export function findCatalogEntry(query: string): CatalogEntry | undefined {
  const raw = query.trim().toLowerCase();
  const exact = getEntry(raw);
  if (exact) return exact;
  const q = norm(query);
  const byName = CATALOG.find((e) => norm(entryName(e)) === q);
  if (byName) return byName;
  for (const [re, id] of SYNONYMS) if (re.test(q)) return getEntry(id);
  return CATALOG.find(
    (e) =>
      norm(entryName(e)).includes(q) ||
      e.catalogId.includes(q.replace(/ /g, '-')),
  );
}
