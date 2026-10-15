import type { SolveInput } from '../layout/solve';
import type { Point } from '../../model/types';

/** The 30 briefs `npm run eval:layout` judges the layout engines on: duplexes, apartment shells with columns, villas. */
export interface LayoutBrief {
  id: string;
  text: string;
  /** Building footprint (m). */
  width: number;
  depth: number;
  /** Fixed columns on a regular grid (apartment shells). */
  columns?: boolean;
  /** Villa on a plot of this size (m). */
  plot?: { width: number; depth: number };
}

const duplex = (
  id: string,
  text: string,
  width: number,
  depth: number,
  columns = false,
): LayoutBrief => ({
  id,
  text,
  width,
  depth,
  columns,
});
const villa = (
  id: string,
  text: string,
  width: number,
  depth: number,
  plot: { width: number; depth: number },
): LayoutBrief => ({ id, text, width, depth, plot });

export const LAYOUT_BRIEFS: LayoutBrief[] = [
  duplex('d-2br-open', '2 bedroom duplex with open kitchen', 8, 10),
  duplex(
    'd-3br',
    '3 bedroom duplex with a living room and kitchen downstairs, bedrooms upstairs',
    10,
    12,
  ),
  duplex('d-3br-study', '3 bedroom duplex, master bedroom with attached bath, study', 9, 13),
  duplex('d-4br', '4 bedrooms and 3 baths, dark wood floors, duplex', 11, 13),
  duplex(
    'd-family',
    'family home for 5: big kitchen with dining, a playroom downstairs, 3 bedrooms upstairs',
    10,
    14,
  ),
  duplex(
    'd-master',
    'master bedroom with attached bath upstairs, two smaller bedrooms, open living and kitchen below',
    9,
    12,
  ),
  duplex(
    'd-doubleheight',
    '3 bedroom house with a double-height living room open to the floor above',
    10,
    12,
  ),
  duplex('d-2br-study', '2 bedrooms, a study, a utility room with laundry, duplex', 8, 11),
  duplex(
    'd-hosting',
    'I love hosting dinners: large open kitchen, dining for 8, living room, two bedrooms, duplex',
    9,
    14,
  ),
  duplex('d-5br', '5 bedroom duplex with 4 baths', 12, 14),
  duplex('d-minimal', 'duplex', 10, 10),
  duplex('d-narrow', '3 bedroom duplex, long and narrow', 7, 15),
  duplex(
    'd-guest',
    'a guest room and bathroom downstairs for my parents, two bedrooms upstairs, duplex',
    10,
    12,
  ),
  duplex('d-scandi', 'bright scandinavian style duplex, 2 bedrooms, light oak floors', 8, 10),
  duplex('d-max', 'as many bedrooms as will fit in a duplex, but keep a nice living room', 12, 12),
  duplex('a-2br', '2 bedroom apartment', 8, 10, true),
  duplex('a-3br', '3 bedroom apartment with 2 baths', 10, 12, true),
  duplex('a-1br', 'one bedroom, small and efficient', 6, 8, true),
  duplex('a-studio', 'studio apartment', 6, 7, true),
  duplex('a-office', '3 bedrooms, home office, modern style', 11, 11, true),
  duplex('a-4br', '4 bedrooms and 3 baths apartment', 12, 13, true),
  villa('v-luxury', 'luxury villa with pool, garden, 2-car garage, gym and sauna', 18, 16, {
    width: 34,
    depth: 42,
  }),
  villa('v-4br-pool', 'villa with 4 bedrooms, pool and garden', 20, 15, { width: 34, depth: 42 }),
  villa(
    'v-3car',
    'luxury villa with pool, garden, 3-car garage, gym, sauna and home theatre',
    22,
    16,
    {
      width: 38,
      depth: 46,
    },
  ),
  villa('v-modern', 'modern villa with 3 bedrooms and a garden', 16, 12, { width: 30, depth: 36 }),
  villa('v-5br', 'villa with 5 bedrooms, pool, spa, game room and a study', 24, 18, {
    width: 40,
    depth: 50,
  }),
  villa('v-compact', 'compact villa with 2 bedrooms and 2 cars parking', 12, 10, {
    width: 24,
    depth: 30,
  }),
  villa('v-family', 'family villa with play area, garden and pool', 18, 14, {
    width: 34,
    depth: 42,
  }),
  villa('v-prayer', 'villa with 4 bedrooms, prayer room, guest room and garden', 20, 14, {
    width: 32,
    depth: 40,
  }),
  villa('v-closet', 'villa with master suite and walk-in closet, 3 bedrooms, pool', 19, 15, {
    width: 34,
    depth: 42,
  }),
  villa('v-small', 'villa with 3 bedrooms, garage for 2 cars and lawn', 15, 12, {
    width: 28,
    depth: 34,
  }),
];

const rectPoly = (x: number, y: number, w: number, d: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

/** What the layout solver is given for a brief: footprint (centred on the plot for villas), south entrance, columns. */
export function solveInputFor(b: LayoutBrief): Omit<SolveInput, 'intent'> {
  let x = 0;
  let y = 0;
  if (b.plot) {
    x = (b.plot.width - b.width) / 2;
    y = Math.max(2, (b.plot.depth - b.depth) * 0.35);
  }
  const columns = b.columns
    ? [1 / 3, 2 / 3].flatMap((fx) =>
        [0.3, 0.7].map((fy) => ({
          position: { x: x + b.width * fx, y: y + b.depth * fy },
          size: { w: 0.3, d: 0.3 },
        })),
      )
    : [];
  return {
    footprint: rectPoly(x, y, b.width, b.depth),
    entrance: { position: { x: x + b.width / 2, y: y + b.depth }, direction: Math.PI / 2 },
    plumbing: [
      { x: x + 1, y: y + b.depth - 1 },
      { x: x + b.width - 1, y: y + 1 },
    ],
    columns,
    plot: b.plot ? rectPoly(0, 0, b.plot.width, b.plot.depth) : undefined,
    maxHeight: 6.2,
  };
}
