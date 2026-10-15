import type { BriefFeature, BriefRoom, DesignBrief, RoomType } from '../model/types';
import { type ProgramWish, defaultProgram, emptyBrief, makeFeature, makeRoom } from './program';
import { styleFromWords } from './styles';

/** What the interview may still ask about: anything the person already said is marked known. */
export type Known =
  'size' | 'levels' | 'household' | 'rooms' | 'features' | 'style' | 'budget' | 'priorities';

export interface ReadBrief {
  brief: DesignBrief;
  known: Known[];
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  single: 1,
  two: 2,
  double: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};
const COUNT = '(\\d+|one|two|three|four|five|six|seven|eight|a|single|double)';
const toNum = (s: string | undefined): number | undefined =>
  s === undefined ? undefined : Number.isFinite(Number(s)) ? Number(s) : WORDS[s];

export const isBengali = (text: string): boolean => /[ঀ-৿]/.test(text);

/** Bengali phrase → English keyword, longest phrases first (the model and the offline reader both think in English). */
const BN_MAP: [RegExp, string][] = [
  [/(\d+)\s*(?:টি|টা|খানা)?\s*(?:বেডরুম|শোবার ঘর|শয়নকক্ষ|বেড রুম)(?:ের)?/g, '$1 bedroom '],
  [/(\d+)\s*(?:টি|টা|খানা)?\s*(?:বাথরুম|টয়লেট|স্নানঘর|ওয়াশরুম)(?:ের)?/g, '$1 bathroom '],
  [/(\d+)\s*(?:টি|টা|খানা)?\s*গাড়ি(?:র)?/g, '$1 car '],
  [/(\d+)\s*জনের\s*পরিবার/g, 'family of $1 '],
  [/(\d+)\s*(?:টি|জন)?\s*(?:বাচ্চা|শিশু|ছেলেমেয়ে)/g, '$1 kids '],
  [/(\d+)\s*(?:তলা|তলার|তলা বিশিষ্ট)/g, '$1 storey '],
  [/একতলা/g, 'single storey '],
  [/(?:দুইতলা|দোতলা|দুই তলা)/g, 'two storey duplex '],
  [/(?:তিনতলা|তিন তলা)/g, 'three storey '],
  [/ডুপ্লেক্স/g, 'duplex '],
  [/(?:ভিলা|বাংলো)/g, 'villa '],
  [/(?:সুইমিং পুল|সুইমিংপুল|পুল)/g, 'pool '],
  [/বাগান/g, 'garden '],
  [/লন/g, 'lawn '],
  [/পার্কিং/g, 'parking '],
  [/গ্যারেজ/g, 'garage '],
  [/খোলা রান্নাঘর/g, 'open kitchen '],
  [/(?:রান্নাঘর|কিচেন)/g, 'kitchen '],
  [/(?:বসার ঘর|ড্রয়িং রুম|ড্রয়িংরুম|লিভিং রুম|লিভিং)/g, 'living room '],
  [/(?:ডাইনিং|খাবার ঘর)/g, 'dining '],
  [/(?:পড়ার ঘর|স্টাডি|অফিস ঘর|হোম অফিস)/g, 'study '],
  [/(?:অতিথি ঘর|গেস্ট রুম|গেস্টরুম)/g, 'guest room '],
  [/(?:নামাজের ঘর|প্রার্থনা ঘর|নামাজ ঘর)/g, 'prayer room '],
  [/জিম/g, 'gym '],
  [/(?:সাউনা|স্টিম)/g, 'sauna '],
  [/(?:খেলার ঘর|গেম রুম)/g, 'game room '],
  [/(?:সিনেমা|থিয়েটার)/g, 'home theatre '],
  [/(?:বাবা-মা|মা-বাবা|বাবা মা|মা বাবা|বৃদ্ধ|দাদা-দাদি|দাদু)/g, 'parents room '],
  [/(?:বাচ্চাদের ঘর|শিশুর ঘর)/g, 'playroom '],
  [/ব্যালকনি|বারান্দা/g, 'balcony '],
  [/(?:বেডরুম|শোবার ঘর)/g, 'bedroom '],
  [/(?:বাথরুম|টয়লেট)/g, 'bathroom '],
  [/(?:বিলাসবহুল|বিলাসী|লাক্সারি)/g, 'luxury '],
  [/(?:আধুনিক|মডার্ন)/g, 'modern '],
  [/(?:ট্রপিক্যাল)/g, 'tropical '],
  [/(?:ক্লাসিক|ঐতিহ্যবাহী)/g, 'classic '],
  [/(?:কম খরচ|সাশ্রয়ী|বাজেট)/g, 'low cost '],
  [/(?:আলো|আলোকিত)/g, 'bright '],
  [/(?:গোপনীয়তা|নিরিবিলি)/g, 'private '],
  [/(?:পরিবার)/g, 'family '],
  [/(?:বাড়ি|ঘর)/g, 'house '],
];

/** Digits, then phrases: "৪ বেডরুমের ভিলা" → "4 bedroom villa". */
export function toEnglish(text: string): string {
  let t = text.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  if (!isBengali(t)) return t;
  for (const [re, to] of BN_MAP) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

const has = (t: string, re: RegExp) => re.test(t);

/** Plot or building size in metres from "30 x 40 ft", "10 by 12 m", "30×40". */
function readSize(t: string): DesignBrief['size'] | undefined {
  const m =
    /(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(m\b|meters?|metres?|ft|feet|foot|'|sq)?/i.exec(
      t,
    );
  if (!m) return undefined;
  const unit = (m[3] ?? '').toLowerCase();
  const k = /ft|feet|foot|'/.test(unit) ? 0.3048 : 1;
  const w = Number(m[1]) * k;
  const d = Number(m[2]) * k;
  if (!(w >= 4 && d >= 4 && w <= 120 && d <= 120)) return undefined;
  const bigger = Math.max(w, d);
  return {
    width: Math.round(w * 10) / 10,
    depth: Math.round(d * 10) / 10,
    of: /plot|land|site/.test(t) || bigger > 24 ? 'plot' : 'building',
  };
}

/**
 * Reads a brief from plain words (English or Bengali) with keyword rules. This is the offline reader and the
 * fallback for a model that answered badly; it also marks what the person already said so the interview can skip it.
 */
export function textToBrief(input: string): ReadBrief {
  const language = isBengali(input) ? 'bn' : 'en';
  const text = ` ${toEnglish(input)
    .toLowerCase()
    .replace(/[,;.()]/g, ' ')} `;
  const known = new Set<Known>();
  const assumptions: DesignBrief['assumptions'] = [];

  // ── What kind of home, how many levels ──
  const featureWords =
    /\bpool\b|\bgarage\b|\bparking\b|\blawn\b|\bplot\b|\bsauna\b|\bgym\b|\bgarden\b|\bcarport\b/;
  const villa =
    has(text, /\bvilla\b|bungalow|mansion|farmhouse|\bestate\b/) || has(text, featureWords);
  let levels: number | undefined;
  const levelMatch = /(\d)\s*(?:storey|story|stories|storeys|floors?|levels?)/.exec(text);
  if (levelMatch) levels = Math.min(3, Math.max(1, Number(levelMatch[1])));
  else if (has(text, /\bduplex\b|two[- ]stor|upstairs|two floors|two levels|double[- ]stor/))
    levels = 2;
  else if (has(text, /three[- ]stor|triplex|three floors|three levels/)) levels = 3;
  else if (
    has(text, /single[- ]stor|one[- ]stor|bungalow|one floor|single floor|single level|ground only/)
  )
    levels = 1;
  if (levels !== undefined) known.add('levels');
  else {
    levels = villa ? 1 : 2;
    assumptions.push({
      key: 'levels',
      text: villa ? 'A single-storey villa' : 'Two levels (a duplex)',
    });
  }

  // ── Bedrooms, bathrooms ──
  const people = new RegExp(`(?:family of|for) ${COUNT}(?: people| persons| adults| of us)?`).exec(
    text,
  );
  const bed = new RegExp(`${COUNT}[\\s-]*(?:bed(?:room)?s?|br|bhk)\\b`).exec(text);
  let bedrooms = toNum(bed?.[1]);
  const kids = new RegExp(`${COUNT}\\s*(?:kids?|children)`).exec(text);
  const adults = people ? toNum(people[1]) : undefined;
  if (bedrooms === undefined && adults !== undefined) bedrooms = Math.max(1, Math.ceil(adults / 2));
  if (bedrooms === undefined && has(text, /\bstudio\b/)) bedrooms = 0;
  if (bedrooms === undefined && has(text, /\bcouple\b|for two\b/)) bedrooms = 1;
  if (bedrooms === undefined && has(text, /\bfamily\b|\bkids?\b|children/)) {
    bedrooms = 3;
    assumptions.push({ key: 'bedrooms', text: '3 bedrooms (a family)' });
  }
  if (bedrooms === undefined) {
    bedrooms = villa ? 3 : 2;
    assumptions.push({ key: 'bedrooms', text: `${bedrooms} bedrooms` });
  }
  bedrooms = Math.min(7, Math.max(0, bedrooms));
  const bathMatch = new RegExp(`${COUNT}[\\s-]*(?:bath(?:room)?s?|wc|toilets?)\\b`).exec(text);
  let baths = toNum(bathMatch?.[1]);
  const ensuite = has(text, /en-?suite|attached bath|own bath|private bath|bath attached/);
  if (baths === undefined)
    baths = ensuite ? bedrooms : Math.max(1, bedrooms >= 4 ? bedrooms - 1 : bedrooms >= 2 ? 2 : 1);
  if (bed || bathMatch || adults !== undefined) known.add('rooms');

  // ── Extra rooms ──
  const extras: ProgramWish['extras'] = [];
  const add = (
    type: RoomType,
    name: string,
    re: RegExp,
    over: Partial<ProgramWish['extras'][number]> = {},
  ) => {
    if (has(text, re)) extras.push({ type, name, ...over });
  };
  add('study', 'Study', /\bstudy\b|\boffice\b|work(?:ing)? from home|\bwfh\b|library/);
  add('utility', 'Utility', /\butility\b|\blaundry\b|\bwashing\b/);
  add('pantry', 'Pantry', /\bpantry\b|\bstore ?room\b/);
  add('gym', 'Gym', /\bgym\b|fitness|workout/);
  add('sauna', 'Sauna', /\bsauna\b|steam room/);
  add('spa', 'Spa', /\bspa\b|jacuzzi|hot tub/);
  add('game-room', 'Game room', /game room|gaming|games room/);
  add('home-theatre', 'Home theatre', /theat(?:re|er)|cinema|media room/);
  add('prayer', 'Prayer room', /prayer|\bnamaz\b|puja|pooja/);
  add('balcony', 'Balcony', /\bbalcon(?:y|ies)\b|\bterrace\b|\bveranda/);
  add('other', 'Playroom', /play ?room|kids? room|nursery/);
  const groundBedroom = has(
    text,
    /parents?|mother|father|elderly|grand(?:parents|ma|pa)|in-laws?|old people/,
  )
    ? { name: has(text, /grand/) ? 'Grandparents room' : 'Parents room' }
    : undefined;
  const guest = has(text, /guest (?:bed)?room|guests? stay|spare room/);
  if (guest) extras.push({ type: 'bedroom', name: 'Guest room', area: 12, level: 0 });
  if (extras.length || groundBedroom || guest) known.add('rooms');

  const open = has(
    text,
    /open[\s-]*(plan|concept|kitchen|living)|kitchen (?:open|flows|connected)|living (?:and|&|with) kitchen/,
  );
  const closet = has(text, /closet|wardrobe|dressing/) || has(text, /luxur|mansion/);
  const program = defaultProgram({
    bedrooms,
    bathrooms: baths,
    levels,
    villa,
    ensuite,
    open,
    extras,
    groundBedroom,
    closet: closet && bedrooms > 0,
  });
  if (bedrooms === 0) {
    // A studio: one open living space with a sleeping corner.
    const living = program.find((r) => r.type === 'living');
    if (living) living.area = 30;
  }

  // ── Outdoors ──
  const features: BriefFeature[] = [];
  const carsMatch = new RegExp(`${COUNT}[\\s-]*car`).exec(text);
  const parkingMention = has(text, /garage|parking|car ?port|\bcars?\b/);
  let cars = parkingMention ? Math.min(6, Math.max(1, toNum(carsMatch?.[1]) ?? 2)) : 0;
  if (parkingMention) {
    features.push(makeFeature('parking', { name: 'Covered parking' }));
    if (!carsMatch) assumptions.push({ key: 'cars', text: 'Parking for 2 cars' });
  }
  const pool = has(text, /\bpool\b|swimming/);
  const garden =
    has(text, /garden|lawn|landscap|green|\byard\b/) || pool || has(text, /luxur|mansion/);
  if (garden && (villa || pool)) {
    features.push(makeFeature('garden', { side: 'front', name: 'Front garden' }));
    features.push(makeFeature('lawn', { side: 'back', name: 'Garden lounge' }));
  } else if (garden) features.push(makeFeature('garden', { side: 'back' }));
  if (pool) {
    features.push(makeFeature('pool', { name: 'Swimming pool' }));
    features.push(makeFeature('deck', { name: 'Pool deck' }));
  }
  if (has(text, /patio|outdoor dining|barbecue|\bbbq\b|gazebo|pergola/))
    features.push(makeFeature('patio', { name: 'Outdoor dining', covered: true }));
  if (has(text, /play area|playground|play space|kids play/))
    features.push(makeFeature('play', { name: 'Kids play area' }));
  if (has(text, /fountain|water feature/))
    features.push(makeFeature('water-feature', { name: 'Fountain' }));
  if (features.length || has(text, /no (?:pool|garden|parking)/)) known.add('features');
  if (cars === 0 && features.some((f) => f.type === 'parking')) cars = 2;

  // ── Style, budget, priorities, household, size ──
  const style = styleFromWords(text);
  if (style) known.add('style');
  const keywords = [
    ...text.matchAll(
      /\b(modern|minimal|cozy|cosy|scandinavian|industrial|classic|tropical|rustic|bright|dark wood|marble|herringbone)\b/g,
    ),
  ].map((m) => m[1]!);
  let budget: DesignBrief['budget'] = 'mid';
  if (has(text, /cheap|low[- ]cost|affordable|economical|tight budget|\bbudget\b|low budget/))
    budget = 'low';
  else if (has(text, /luxur|mansion|lavish|opulent/)) budget = 'luxury';
  else if (has(text, /premium|high[- ]end|upscale|expensive/)) budget = 'high';
  if (budget !== 'mid' || has(text, /mid[- ]range|moderate/)) known.add('budget');
  else assumptions.push({ key: 'budget', text: 'A mid-range budget' });
  const priorities: DesignBrief['priorities'] = [];
  if (has(text, /bright|sunlight|natural light|daylight|light[- ]filled|airy/))
    priorities.push('light');
  if (has(text, /privat|quiet|secluded/)) priorities.push('privacy');
  if (open || has(text, /spacious|open feel/)) priorities.push('open-plan');
  if (has(text, /storage|cupboard|closets?\b/)) priorities.push('storage');
  if (garden) priorities.push('garden');
  if (budget === 'low') priorities.push('cost');
  if (priorities.length) known.add('priorities');
  const householdKnown = has(text, /family|kids?|children|elderly|parents|guests?|people|couple/);
  if (householdKnown) known.add('household');
  const size = readSize(input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).toLowerCase());
  if (size) known.add('size');
  const kidsN = toNum(kids?.[1]);
  assumptions.push({ key: 'ceiling', text: 'Ceilings about 3.0 m' });

  const brief = emptyBrief({
    language,
    levels,
    kind: villa ? 'villa' : 'duplex',
    size,
    program,
    features: dedupe(features),
    cars,
    style: { preset: style?.id, keywords: [...new Set(keywords)].slice(0, 8), palette: [] },
    budget,
    priorities: [...new Set(priorities)],
    household: householdKnown
      ? {
          adults: Math.max(1, adults !== undefined ? Math.min(adults, 2) : 2),
          children: kidsN ?? (has(text, /kids?|children|family/) ? 2 : 0),
          elderly: groundBedroom ? 1 : 0,
          guests: guest,
          help: has(text, /maid|domestic|help\b|nanny|caretaker/),
        }
      : undefined,
    assumptions,
    source: input.slice(0, 4000),
  });
  void kidsN;
  return { brief, known: [...known] };
}

function dedupe(list: BriefFeature[]): BriefFeature[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    const k = f.type + (f.name ?? '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const roomsOfType = (b: DesignBrief, type: RoomType): BriefRoom[] =>
  b.program.filter((r) => r.type === type);

/** A one-line plain summary for the "I understood" message. */
export function understood(b: DesignBrief): string[] {
  const beds = roomsOfType(b, 'bedroom').length;
  const baths = roomsOfType(b, 'bathroom').length;
  const out = [
    `${b.levels} ${b.levels === 1 ? 'level' : 'levels'}`,
    `${beds} bedroom${beds === 1 ? '' : 's'}`,
    `${baths} bathroom${baths === 1 ? '' : 's'}`,
  ];
  const extra = b.program
    .filter(
      (r) =>
        !['living', 'dining', 'kitchen', 'bedroom', 'bathroom', 'foyer', 'walk-in-closet'].includes(
          r.type,
        ),
    )
    .map((r) => r.name.toLowerCase());
  if (extra.length) out.push(extra.join(', '));
  if (b.features.length) out.push([...new Set(b.features.map((f) => f.type))].join(', '));
  return out;
}

export { makeRoom };
