/**
 * Reading what a plan's labels say: "Bedroom 1  14' x 12'", "Kitchen 4.2 × 3.6 m". Pure text handling — the model only
 * has to copy the text, never to interpret it.
 */
const FT_PER_M = 1 / 0.3048;

export interface ParsedSize {
  /** Width and depth as written, in feet. */
  size: [number, number];
  /** The unit it was written in. */
  unit: 'ft' | 'm';
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
// 14' x 12'   14′ × 12′   14 x 12 ft   14ft x 12ft   14'6" x 12'   4.2 × 3.6 m   4200 x 3600 mm
const SEP = String.raw`\s*[x×X*]\s*`;
const FEET_INCHES = String.raw`(\d+)\s*(?:'|′|’|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|”|in|inches)?)?`;

const num = (s: string) => Number(s.replace(',', '.'));

/** Reads a size such as `14' x 12'` or `4.2 × 3.6 m` anywhere in `text`; null when there is none. */
export function parseSize(text: string): ParsedSize | null {
  const t = text.replace(/\s+/g, ' ');
  // feet and inches on either side
  const ft = new RegExp(`${FEET_INCHES}${SEP}${FEET_INCHES}`, 'i').exec(t);
  if (ft) {
    const a = Number(ft[1]) + (ft[2] ? Number(ft[2]) / 12 : 0);
    const b = Number(ft[3]) + (ft[4] ? Number(ft[4]) / 12 : 0);
    if (a > 0 && b > 0) return { size: [a, b], unit: 'ft' };
  }
  // plain numbers followed by a unit
  const withUnit = new RegExp(
    `${NUM}\\s*(m|mm|cm|ft|feet|')?${SEP}${NUM}\\s*(mm|cm|m|ft|feet|')?`,
    'i',
  ).exec(t);
  if (withUnit) {
    const unit = (withUnit[4] ?? withUnit[2] ?? '').toLowerCase();
    let a = num(withUnit[1]!);
    let b = num(withUnit[3]!);
    if (unit === 'mm') [a, b] = [a / 1000, b / 1000];
    else if (unit === 'cm') [a, b] = [a / 100, b / 100];
    if (unit === 'm' || unit === 'mm' || unit === 'cm')
      return a > 0 && b > 0 ? { size: [a * FT_PER_M, b * FT_PER_M], unit: 'm' } : null;
    if (unit === 'ft' || unit === 'feet' || unit === "'")
      return a > 0 && b > 0 ? { size: [a, b], unit: 'ft' } : null;
  }
  return null;
}

/** The label's name without its size ("Bedroom 1  14' x 12'" → "Bedroom 1"). */
export function nameOf(text: string): string {
  const stripped = text
    .replace(
      /\d+(?:[.,]\d+)?\s*(?:'|′|’|ft|feet|m|mm|cm)?\s*(?:\d+\s*(?:"|″|”|in))?\s*[x×X*]\s*\d+(?:[.,]\d+)?\s*(?:'|′|’|ft|feet|m|mm|cm)?\s*(?:\d+\s*(?:"|″|”|in))?/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '');
}

export type Kind = 'room' | 'zone';
export interface Classified {
  kind: Kind;
  /** A room type (see `ROOM_TYPES`) or a zone type (see `ZONE_TYPES`). */
  type: string;
}

/** Keyword → what it is. The first match wins, so the specific ones come first. */
const RULES: [RegExp, Classified][] = [
  [/walk[- ]?in|closet|wardrobe|dressing/, { kind: 'room', type: 'walk-in-closet' }],
  [/\b(bath|toilet|wc|powder|shower|ensuite|en-suite)/, { kind: 'room', type: 'bathroom' }],
  [/\b(bed ?room|master|guest|kids? room|nursery)/, { kind: 'room', type: 'bedroom' }],
  [/\b(sauna)/, { kind: 'room', type: 'sauna' }],
  [/\b(spa|jacuzzi|steam)/, { kind: 'room', type: 'spa' }],
  [/\b(gym|fitness|workout)/, { kind: 'room', type: 'gym' }],
  [/\b(gaming|game|games|arcade)/, { kind: 'room', type: 'game-room' }],
  [/\b(theat(re|er)|cinema|media)/, { kind: 'room', type: 'home-theatre' }],
  [/\b(kitchen|kitchenette)/, { kind: 'room', type: 'kitchen' }],
  [/\b(utility|laundry|wash)/, { kind: 'room', type: 'utility' }],
  [/\b(store|storage|pantry)/, { kind: 'room', type: 'pantry' }],
  [
    /\b(foyer|entrance hall|entry|lobby|vestibule)\b(?! path| gate)/,
    { kind: 'room', type: 'foyer' },
  ],
  [/\b(stair|staircase)/, { kind: 'room', type: 'stair' }],
  [/\b(corridor|hall|hallway|passage)/, { kind: 'room', type: 'corridor' }],
  [/\b(study|office|library)/, { kind: 'room', type: 'study' }],
  [/\b(prayer|pooja|puja)/, { kind: 'room', type: 'prayer' }],
  [/\b(garage)/, { kind: 'room', type: 'garage' }],
  // outdoors
  [/\b(pool|swimming)/, { kind: 'zone', type: 'pool' }],
  [/\b(car|parking|carport|car port)/, { kind: 'zone', type: 'parking' }],
  [/\b(kids? play|playground|play area|play)/, { kind: 'zone', type: 'play' }],
  [/\b(fire[- ]?pit|deck)/, { kind: 'zone', type: 'deck' }],
  [/\b(outdoor dining|patio|pergola|barbecue|bbq)/, { kind: 'zone', type: 'patio' }],
  [/\b(driveway|path|walkway|steps)/, { kind: 'zone', type: 'path' }],
  [/\b(water|fountain|pond)/, { kind: 'zone', type: 'water-feature' }],
  [/\b(lawn|lounge|garden)/, { kind: 'zone', type: 'lawn' }],
  [/\b(terrace|balcony|roof)/, { kind: 'room', type: 'outdoor' }],
  // living spaces last: "Living & Dining Area" is a living room
  [/\b(living|lounge room|family|sitting)/, { kind: 'room', type: 'living' }],
  [/\b(dining)/, { kind: 'room', type: 'dining' }],
];

/** What a label names: an indoor room or an outdoor area, and its type. Unknown names are rooms of type `other`. */
export function classify(name: string): Classified {
  const n = name.toLowerCase();
  // "Outdoor Dining" is a patio, "Living & Dining Area" is a living room.
  if (/outdoor/.test(n) && /dining|kitchen|lounge/.test(n)) return { kind: 'zone', type: 'patio' };
  for (const [re, c] of RULES) if (re.test(n)) return c;
  return { kind: 'room', type: 'other' };
}

/** A key for comparing names: lower case, no punctuation, no filler words ("Master Bedroom" ≈ "master bedroom 1"). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|a|an|room|area|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How alike two names are, 0–1 (shared words over the larger set; numbers must agree). */
export function nameSimilarity(a: string, b: string): number {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const na = ka.match(/\d+/g)?.join(',') ?? '';
  const nb = kb.match(/\d+/g)?.join(',') ?? '';
  if (na && nb && na !== nb) return 0.2;
  const wa = new Set(ka.split(' '));
  const wb = new Set(kb.split(' '));
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

export const slug = (name: string): string =>
  nameKey(name).replace(/ /g, '-').replace(/-+/g, '-').slice(0, 40) || 'room';
