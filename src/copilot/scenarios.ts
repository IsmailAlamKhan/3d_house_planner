import type { RoomType } from '../model/types';
import type { SketchBox } from './sketch';

/** What a design must show for the brief to count as followed (checked by code, never by a model). */
export interface Expect {
  levels?: number;
  /** Regular bedrooms (guest rooms and rooms for parents are counted separately). */
  bedrooms?: number;
  /** Room types or names that must be in the plan. */
  rooms?: string[];
  /** …and must not be. */
  absent?: string[];
  features?: string[];
  noFeatures?: string[];
  cars?: number;
  /** A room's wanted area in m² by name: the plan's room must be within 45 % of it once scaled to the shell. */
  style?: string;
  budget?: string;
  /** Rooms on the ground floor of a multi-level plan. */
  ground?: string[];
}

export type Scenario =
  | { id: string; kind: 'text'; text: string; expect: Expect; note?: string }
  | {
      id: string;
      kind: 'interview';
      text?: string;
      answers: { chips: string[]; text?: string }[];
      expect: Expect;
    }
  | { id: string; kind: 'sketch'; boxes: SketchBox[]; expect: Expect }
  | {
      id: string;
      kind: 'like';
      base: 'reference' | 'project' | string;
      request: string;
      expect: Expect;
    }
  | { id: string; kind: 'refine'; text: string; command: string; expect: Expect };

const box = (
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  type?: RoomType,
): SketchBox => ({ name, type, x, y, w, h });

export const SCENARIOS: Scenario[] = [
  // ── 15 text briefs (4 in Bengali, 3 vague) ──
  {
    id: 't-villa-pool',
    kind: 'text',
    text: 'I want a 4-bedroom villa with a pool for my family',
    expect: { bedrooms: 4, features: ['pool'], rooms: ['living', 'kitchen'] },
  },
  {
    id: 't-luxury',
    kind: 'text',
    text: 'luxury villa with pool, garden, 2-car garage, gym and sauna',
    expect: { features: ['pool', 'garden', 'parking'], cars: 2, rooms: ['gym', 'sauna'] },
  },
  {
    id: 't-duplex-3',
    kind: 'text',
    text: '3 bedroom duplex with a living room and kitchen downstairs, bedrooms upstairs',
    expect: { levels: 2, bedrooms: 3, ground: ['living', 'kitchen'] },
  },
  {
    id: 't-mother',
    kind: 'text',
    text: '3 bedroom duplex with open kitchen and a room for my mother downstairs',
    expect: { levels: 2, bedrooms: 3, rooms: ['Parents room'], ground: ['Parents room'] },
  },
  {
    id: 't-small',
    kind: 'text',
    text: '2 bedroom duplex with open kitchen',
    expect: { levels: 2, bedrooms: 2 },
  },
  {
    id: 't-study',
    kind: 'text',
    text: '3 bedrooms, home office, modern style',
    expect: { bedrooms: 3, rooms: ['study'], style: 'modern-luxury' },
  },
  {
    id: 't-family5',
    kind: 'text',
    text: 'family home for 5 with 3 bedrooms and a playroom, tropical style',
    expect: { bedrooms: 3, rooms: ['Playroom'], style: 'tropical' },
  },
  {
    id: 't-prayer',
    kind: 'text',
    text: 'villa with 4 bedrooms, prayer room, guest room and garden',
    expect: { bedrooms: 4, rooms: ['prayer', 'Guest room'], features: ['garden'] },
  },
  {
    id: 't-vague1',
    kind: 'text',
    text: 'something cozy for 2 people with a home office',
    expect: { rooms: ['study'] },
    note: 'vague',
  },
  {
    id: 't-vague2',
    kind: 'text',
    text: 'a big family house with a garden',
    expect: { features: ['garden'] },
    note: 'vague',
  },
  { id: 't-vague3', kind: 'text', text: 'duplex', expect: { levels: 2 }, note: 'vague' },
  {
    id: 'b-villa',
    kind: 'text',
    text: '৪ বেডরুমের ভিলা সুইমিং পুল ও বাগান সহ',
    expect: { bedrooms: 4, features: ['pool', 'garden'] },
    note: 'Bengali',
  },
  {
    id: 'b-duplex',
    kind: 'text',
    text: '৩টি শোবার ঘর সহ দুইতলা বাড়ি, খোলা রান্নাঘর',
    expect: { levels: 2, bedrooms: 3, rooms: ['kitchen'] },
    note: 'Bengali',
  },
  {
    id: 'b-parking',
    kind: 'text',
    text: 'পার্কিং সহ ডুপ্লেক্স বাড়ি, ২টি গাড়ি, ২টি শোবার ঘর',
    expect: { levels: 2, bedrooms: 2, features: ['parking'], cars: 2 },
    note: 'Bengali',
  },
  {
    id: 'b-parents',
    kind: 'text',
    text: 'বাবা-মায়ের জন্য নিচতলায় ঘরসহ ৩ বেডরুমের ডুপ্লেক্স',
    expect: { levels: 2, bedrooms: 3, rooms: ['Parents room'] },
    note: 'Bengali',
  },

  // ── 5 interview transcripts ──
  {
    id: 'i-family',
    kind: 'interview',
    answers: [
      { chips: ['medium'] },
      { chips: ['two'] },
      { chips: ['family'] },
      { chips: ['office'] },
      { chips: ['pool', 'parking2'] },
      { chips: ['modern-luxury'] },
      { chips: ['high'] },
      { chips: ['light', 'privacy'] },
    ],
    expect: {
      levels: 2,
      bedrooms: 4,
      rooms: ['Home office'],
      features: ['pool', 'parking'],
      cars: 2,
      style: 'modern-luxury',
      budget: 'high',
    },
  },
  {
    id: 'i-couple',
    kind: 'interview',
    answers: [
      { chips: ['small'] },
      { chips: ['one'] },
      { chips: ['couple'] },
      { chips: [] },
      { chips: [] },
      { chips: ['warm-minimal'] },
      { chips: ['low'] },
    ],
    expect: { levels: 1, bedrooms: 2, style: 'warm-minimal', budget: 'low' },
  },
  {
    id: 'i-elderly',
    kind: 'interview',
    text: 'a duplex for us and my parents',
    answers: [{ chips: ['large'] }, { chips: ['pool'] }],
    expect: { levels: 2, rooms: ['Parents room'], ground: ['Parents room'], features: ['pool'] },
  },
  {
    id: 'i-guests',
    kind: 'interview',
    answers: [
      { chips: ['medium'] },
      { chips: ['three'] },
      { chips: ['guests'] },
      { chips: ['prayer', 'utility'] },
    ],
    expect: { levels: 3, rooms: ['Guest room', 'prayer', 'utility'] },
  },
  {
    id: 'i-free',
    kind: 'interview',
    answers: [
      { chips: [], text: '12 x 15 m building' },
      { chips: ['two'] },
      { chips: [], text: 'three bedrooms with their own bathrooms' },
      { chips: [] },
      { chips: ['garden'] },
    ],
    expect: { levels: 2, bedrooms: 3, features: ['garden'] },
  },

  // ── 5 sketches (rough boxes drawn in the app) ──
  {
    id: 's-six',
    kind: 'sketch',
    boxes: [
      box('Living', 0, 0.45, 0.45, 0.55),
      box('Kitchen', 0.45, 0.6, 0.25, 0.4),
      box('Dining', 0.7, 0.6, 0.3, 0.4),
      box('Bedroom 1', 0, 0, 0.35, 0.45),
      box('Bedroom 2', 0.35, 0, 0.35, 0.45),
      box('Bath', 0.7, 0, 0.3, 0.45),
    ],
    expect: { rooms: ['living', 'kitchen', 'dining', 'bathroom'], bedrooms: 2 },
  },
  {
    id: 's-l',
    kind: 'sketch',
    boxes: [
      box('Living room', 0, 0, 0.5, 0.5),
      box('Kitchen', 0.5, 0, 0.5, 0.35),
      box('Master BR', 0, 0.5, 0.4, 0.5),
      box('BR 2', 0.4, 0.5, 0.3, 0.5),
      box('Toilet', 0.7, 0.5, 0.3, 0.5),
    ],
    expect: { rooms: ['living', 'kitchen', 'bathroom'], bedrooms: 2 },
  },
  {
    id: 's-three',
    kind: 'sketch',
    boxes: [
      box('Lounge', 0.2, 0.3, 0.6, 0.4),
      box('Bedroom', 0, 0, 0.5, 0.3),
      box('Bedroom 2', 0.5, 0, 0.5, 0.3),
      box('Bedroom 3', 0, 0.7, 0.5, 0.3),
      box('Kitchen', 0.5, 0.7, 0.5, 0.3),
    ],
    expect: { rooms: ['living', 'kitchen'], bedrooms: 3 },
  },
  {
    id: 's-office',
    kind: 'sketch',
    boxes: [
      box('Living', 0, 0, 0.5, 0.6),
      box('Study', 0.5, 0, 0.5, 0.35),
      box('Kitchen', 0.5, 0.35, 0.5, 0.25),
      box('Bedroom', 0, 0.6, 0.6, 0.4),
      box('Bath', 0.6, 0.6, 0.4, 0.4),
    ],
    expect: { rooms: ['living', 'study', 'kitchen', 'bathroom'], bedrooms: 1 },
  },
  {
    id: 's-wide',
    kind: 'sketch',
    boxes: [
      box('Hall', 0.3, 0.3, 0.4, 0.4, 'living'),
      box('Bed 1', 0, 0, 0.3, 0.5),
      box('Bed 2', 0, 0.5, 0.3, 0.5),
      box('Kitchen', 0.7, 0, 0.3, 0.5),
      box('Bath', 0.7, 0.5, 0.3, 0.5),
    ],
    expect: { rooms: ['living', 'kitchen', 'bathroom'], bedrooms: 2 },
  },

  // ── 5 "like this, but…" ──
  {
    id: 'l-ref-2st',
    kind: 'like',
    base: 'reference',
    request: 'but 2 storeys and 4 bedrooms, no gaming room, smaller pool',
    expect: {
      levels: 2,
      bedrooms: 4,
      absent: ['game-room'],
      features: ['pool', 'parking', 'garden'],
    },
  },
  {
    id: 'l-ref-small',
    kind: 'like',
    base: 'reference',
    request: 'but no sauna and no spa, add a study',
    expect: { absent: ['sauna', 'spa'], rooms: ['study'], features: ['pool'] },
  },
  {
    id: 'l-ref-cars',
    kind: 'like',
    base: 'reference',
    request: 'but parking for 3 cars and a bigger kitchen',
    expect: { cars: 3, features: ['parking'] },
  },
  {
    id: 'l-tpl',
    kind: 'like',
    base: 'luxury-villa',
    request: 'but 5 bedrooms',
    expect: { bedrooms: 5 },
  },
  {
    id: 'l-project',
    kind: 'like',
    base: 'project',
    request: 'but add a pool and 2 car parking',
    expect: { features: ['pool', 'parking'], cars: 2 },
  },

  // ── 10 refinement commands ──
  {
    id: 'r-kitchen',
    kind: 'refine',
    text: '3 bedroom villa with garden',
    command: 'bigger kitchen',
    expect: { bedrooms: 3, rooms: ['kitchen'] },
  },
  {
    id: 'r-bedroom',
    kind: 'refine',
    text: '3 bedroom duplex',
    command: 'add a bedroom',
    expect: { bedrooms: 4, levels: 2 },
  },
  {
    id: 'r-pool',
    kind: 'refine',
    text: '3 bedroom villa with garden',
    command: 'add a pool',
    expect: { features: ['pool'], bedrooms: 3 },
  },
  {
    id: 'r-parking',
    kind: 'refine',
    text: '3 bedroom villa with garden',
    command: 'add parking for 2 cars',
    expect: { features: ['parking'], cars: 2 },
  },
  {
    id: 'r-mother',
    kind: 'refine',
    text: '3 bedroom duplex',
    command: 'add a room for my mother on the ground floor with its own bathroom',
    expect: { levels: 2, bedrooms: 3, rooms: ['mother'], ground: ['mother'] },
  },
  {
    id: 'r-cheaper',
    kind: 'refine',
    text: 'luxury villa with pool and garden',
    command: 'make it cheaper',
    expect: { budget: 'high', features: ['pool'] },
  },
  {
    id: 'r-luxury',
    kind: 'refine',
    text: '3 bedroom duplex',
    command: 'make it luxurious',
    expect: { budget: 'high', style: 'modern-luxury', levels: 2 },
  },
  {
    id: 'r-light',
    kind: 'refine',
    text: '3 bedroom duplex',
    command: 'more light in the bedrooms',
    expect: { bedrooms: 3, levels: 2 },
  },
  {
    id: 'r-nogym',
    kind: 'refine',
    text: 'villa with gym, sauna and pool',
    command: 'remove the gym',
    expect: { absent: ['gym'], rooms: ['sauna'], features: ['pool'] },
  },
  {
    id: 'r-bn',
    kind: 'refine',
    text: '3 bedroom villa with garden',
    command: 'আরও আলো চাই, আর একটি পুল যোগ করুন',
    expect: { features: ['pool'], bedrooms: 3 },
  },
];
