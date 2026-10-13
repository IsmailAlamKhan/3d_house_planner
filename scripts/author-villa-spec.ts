/**
 * Authoring source of `reference/villa.spec.json`: the Reference Villa traced from `reference/villa-reference.png`.
 *
 *   npx tsx scripts/author-villa-spec.ts        → writes reference/villa.spec.json
 *   npm run reference:build -- reference/villa.spec.json     → builds the project and FIDELITY.md
 *
 * Why a script and not a hand-edited JSON: Option B ("as pictured") is *measured*. Every room of Option B is a pixel
 * box on the picture; the script straightens the picture with the same homography the app uses for the reference
 * underlay (`src/geometry/homography.ts`), so what is drawn on the plan lines up with the picture at 50 % opacity by
 * construction. Option A ("as labelled") gives every labelled room exactly its label size. Both options share the
 * same furnishing rules, so they contain the same inventory. The output is a plain, human-readable spec.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import polygonClipping from 'polygon-clipping';
import { getEntry } from '../src/catalog';
import { applyHomography, rectifyFromCorners } from '../src/geometry/homography';
import { type ReferenceSpecInput, parseReferenceSpec } from '../src/reference/spec';

type Pt = [number, number];
type Rect = [number, number, number, number];
type Shape = { rect?: Rect; polygon?: Pt[] };
type Design = ReferenceSpecInput['designs'][number];
type Item = NonNullable<Design['items']>[number];
type Opening = NonNullable<Design['openings']>[number];

const OUT = 'reference/villa.spec.json';
const IMAGE = 'reference/villa-reference.png';
const IMAGE_SIZE: [number, number] = [720, 1600];
const M_PER_FT = 0.3048;

// ───────────────────────────── the plot and the picture ─────────────────────────────

const PLOT_W = 74;
const PLOT_D = 98;
/** The picture's boundary wall: top-left, top-right, bottom-right, bottom-left, in picture pixels. */
let PIC_CORNERS: Pt[] = [
  [60, 218],
  [698, 222],
  [712, 1197],
  [14, 1197],
];
/** Where the picture's top-left corner lands on the plan (Option B sits inside the shared plot). */
// (its front wall stands on the plot's front edge, where the gates are: a gate snaps onto the plot boundary)
const WALL_INSET = 0.35;
const B_ORIGIN: Pt = [8, PLOT_D - WALL_INSET - 84.5];

/** Parking in the picture: 236 px wide. The scale is set so that it is 20 ft (the label of the picture). */
const PARKING_PX: [number, number, number, number] = [452, 885, 688, 1098];
function calibrate(): { width: number; depth: number } {
  const probe = (w: number) => {
    const h = rectifyFromCorners(
      PIC_CORNERS.map(([x, y]) => ({ x, y })),
      w,
      w * 1.4,
      { x: 0, y: 0 },
    )!;
    const a = applyHomography(h, { x: PARKING_PX[0], y: (PARKING_PX[1] + PARKING_PX[3]) / 2 });
    const b = applyHomography(h, { x: PARKING_PX[2], y: (PARKING_PX[1] + PARKING_PX[3]) / 2 });
    return b.x - a.x;
  };
  const width = Math.round(((58 * 20) / probe(58)) * 100) / 100;
  const avgPx = (698 - 60 + (712 - 14)) / 2;
  const depth = Math.round(((width * (1197 - 218)) / avgPx) * 2) / 2;
  return { width, depth };
}
let CAL = calibrate();
let H = rectifyFromCorners(
  PIC_CORNERS.map(([x, y]) => ({ x, y })),
  CAL.width,
  CAL.depth,
  { x: B_ORIGIN[0], y: B_ORIGIN[1] },
)!;
function remap(corners: Pt[]): void {
  PIC_CORNERS = corners;
  CAL = calibrate();
  H = rectifyFromCorners(
    corners.map(([x, y]) => ({ x, y })),
    CAL.width,
    CAL.depth,
    { x: B_ORIGIN[0], y: B_ORIGIN[1] },
  )!;
}
const P = (x: number, y: number): Pt => {
  const q = applyHomography(H, { x, y });
  return [q.x, q.y];
};

// ───────────────────────────── geometry helpers ─────────────────────────────

const q25 = (v: number) => Math.round(v * 4) / 4;
const rectPoly = (r: Rect): Pt[] => [
  [r[0], r[1]],
  [r[0] + r[2], r[1]],
  [r[0] + r[2], r[1] + r[3]],
  [r[0], r[1] + r[3]],
];
const polyOf = (s: Shape): Pt[] => s.polygon ?? rectPoly(s.rect!);
const bbox = (s: Shape): Rect => {
  const p = polyOf(s);
  const xs = p.map((a) => a[0]);
  const ys = p.map((a) => a[1]);
  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  ];
};
const shift = (s: Shape, dx: number, dy: number): Shape =>
  s.rect
    ? { rect: [s.rect[0] + dx, s.rect[1] + dy, s.rect[2], s.rect[3]] }
    : { polygon: s.polygon!.map(([x, y]) => [x + dx, y + dy] as Pt) };

/** A picture box [x0, y0, x1, y1] (pixels) as a plan rectangle: each side is the mean of its two mapped corners. */
function boxToRect(b: [number, number, number, number]): Rect {
  const tl = P(b[0], b[1]);
  const tr = P(b[2], b[1]);
  const br = P(b[2], b[3]);
  const bl = P(b[0], b[3]);
  const x0 = (tl[0] + bl[0]) / 2;
  const x1 = (tr[0] + br[0]) / 2;
  const y0 = (tl[1] + tr[1]) / 2;
  const y1 = (bl[1] + br[1]) / 2;
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Longest stretch two polygons share along a straight edge (a wall between them). */
function sharedSegment(a: Pt[], b: Pt[]): { p: Pt; q: Pt; len: number } | null {
  let best: { p: Pt; q: Pt; len: number } | null = null;
  const n = (arr: Pt[]) => arr.map((p, i) => [p, arr[(i + 1) % arr.length]!] as [Pt, Pt]);
  for (const [a1, a2] of n(a))
    for (const [b1, b2] of n(b)) {
      const dx = a2[0] - a1[0];
      const dy = a2[1] - a1[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const ux = dx / L;
      const uy = dy / L;
      const dist = (p: Pt) => Math.abs((p[0] - a1[0]) * uy - (p[1] - a1[1]) * ux);
      if (dist(b1) > 0.02 || dist(b2) > 0.02) continue;
      const t1 = (b1[0] - a1[0]) * ux + (b1[1] - a1[1]) * uy;
      const t2 = (b2[0] - a1[0]) * ux + (b2[1] - a1[1]) * uy;
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(L, Math.max(t1, t2));
      if (hi - lo > (best?.len ?? 0.5))
        best = {
          p: [a1[0] + ux * lo, a1[1] + uy * lo],
          q: [a1[0] + ux * hi, a1[1] + uy * hi],
          len: hi - lo,
        };
    }
  return best;
}

/** Stretches of a polygon's edges that no other polygon touches (the outside walls). */
function freeEdges(poly: Pt[], others: Pt[][], minLen: number): { p: Pt; q: Pt; len: number }[] {
  const out: { p: Pt; q: Pt; len: number }[] = [];
  poly.forEach((a1, i) => {
    const a2 = poly[(i + 1) % poly.length]!;
    const dx = a2[0] - a1[0];
    const dy = a2[1] - a1[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    const ux = dx / L;
    const uy = dy / L;
    const covered: [number, number][] = [];
    for (const o of others)
      o.forEach((b1, j) => {
        const b2 = o[(j + 1) % o.length]!;
        const dist = (p: Pt) => Math.abs((p[0] - a1[0]) * uy - (p[1] - a1[1]) * ux);
        if (dist(b1) > 0.02 || dist(b2) > 0.02) return;
        const t1 = (b1[0] - a1[0]) * ux + (b1[1] - a1[1]) * uy;
        const t2 = (b2[0] - a1[0]) * ux + (b2[1] - a1[1]) * uy;
        const lo = Math.max(0, Math.min(t1, t2));
        const hi = Math.min(L, Math.max(t1, t2));
        if (hi - lo > 0.05) covered.push([lo, hi]);
      });
    covered.sort((x, y) => x[0] - y[0]);
    let t = 0;
    const gaps: [number, number][] = [];
    for (const [lo, hi] of covered) {
      if (lo > t + 0.05) gaps.push([t, lo]);
      t = Math.max(t, hi);
    }
    if (t < L - 0.05) gaps.push([t, L]);
    for (const [lo, hi] of gaps)
      if (hi - lo >= minLen)
        out.push({
          p: [a1[0] + ux * lo, a1[1] + uy * lo],
          q: [a1[0] + ux * hi, a1[1] + uy * hi],
          len: hi - lo,
        });
  });
  return out;
}

const inPoly = (p: Pt, poly: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

// ───────────────────────────── catalogue sizes ─────────────────────────────

/** Default size of a catalogue item in feet. */
function S(catalog: string): { w: number; d: number; h: number } {
  const e = getEntry(catalog);
  if (!e) throw new Error(`unknown catalogue item ${catalog}`);
  return {
    w: e.defaultSize.w / M_PER_FT,
    d: e.defaultSize.d / M_PER_FT,
    h: e.defaultSize.h / M_PER_FT,
  };
}

// ───────────────────────────── the topology of the picture ─────────────────────────────

interface RoomT {
  id: string;
  name: string;
  type: string;
  label?: [number, number];
  floor?: string;
  wallFinish?: string;
  note?: string;
  level?: string;
  /** Present in only one option (a filler the picture does not label). */
  only?: 'A' | 'B';
}

const ROOMS: RoomT[] = [
  { id: 'utility', name: 'Utility', type: 'utility', label: [6, 8], wallFinish: 'paint-white' },
  {
    id: 'store',
    name: 'Store (not labelled)',
    type: 'pantry',
    only: 'A',
    note: 'Fills the 6′ × 4′ left under the 6′ × 8′ utility room so the wing is a clean rectangle.',
  },
  { id: 'kitchen', name: 'Kitchen', type: 'kitchen', label: [16, 12], wallFinish: 'paint-cream' },
  {
    id: 'bed2',
    name: 'Bedroom 2',
    type: 'bedroom',
    label: [14, 12],
    floor: 'floor-walnut',
    wallFinish: 'paint-sage',
  },
  {
    id: 'corridorL',
    name: 'Left corridor and stair hall (not labelled)',
    type: 'corridor',
    floor: 'floor-marble',
    wallFinish: 'paint-cream',
  },
  { id: 'bath2', name: 'Bath 2', type: 'bathroom', label: [8, 6], wallFinish: 'paint-grey' },
  {
    id: 'closet',
    name: 'Walk-in Closet',
    type: 'walk-in-closet',
    label: [8, 6],
    floor: 'floor-walnut',
  },
  {
    id: 'guestL',
    name: 'Guest Room (left)',
    type: 'bedroom',
    label: [18, 14],
    floor: 'floor-walnut',
    wallFinish: 'paint-sage',
  },
  {
    id: 'ensuite',
    name: 'Guest Ensuite (not labelled)',
    type: 'bathroom',
    wallFinish: 'paint-grey',
  },
  {
    id: 'bed1',
    name: 'Bedroom 1',
    type: 'bedroom',
    label: [14, 12],
    floor: 'floor-walnut',
    wallFinish: 'paint-sage',
  },
  {
    id: 'living',
    name: 'Living & Dining Area',
    type: 'living',
    label: [18, 28],
    floor: 'floor-marble',
    wallFinish: 'paint-cream',
  },
  {
    id: 'foyer',
    name: 'Foyer',
    type: 'foyer',
    label: [10, 8],
    floor: 'floor-marble',
    wallFinish: 'paint-cream',
  },
  {
    id: 'bed3',
    name: 'Bedroom 3',
    type: 'bedroom',
    label: [14, 12],
    floor: 'floor-walnut',
    wallFinish: 'paint-grey',
  },
  { id: 'bath3', name: 'Bath 3', type: 'bathroom', label: [8, 6], wallFinish: 'paint-grey' },
  {
    id: 'gaming',
    name: 'Gaming Room',
    type: 'game-room',
    label: [16, 12],
    floor: 'floor-carpet-grey',
    wallFinish: 'paint-charcoal',
  },
  {
    id: 'guestR',
    name: 'Guest Room (right)',
    type: 'bedroom',
    label: [14, 11],
    floor: 'floor-walnut',
    wallFinish: 'paint-sage',
  },
  { id: 'bathR', name: 'Guest Bath', type: 'bathroom', label: [8, 5], wallFinish: 'paint-grey' },
  {
    id: 'dressR',
    name: 'Guest Dressing (not labelled)',
    type: 'walk-in-closet',
    floor: 'floor-walnut',
    only: 'A',
    note: 'In the picture this strip belongs to the guest bath (Option B).',
  },
  { id: 'gym', name: 'Gym', type: 'gym', label: [14, 12], wallFinish: 'paint-charcoal' },
  { id: 'sauna', name: 'Sauna', type: 'sauna', label: [8, 6] },
  { id: 'spa', name: 'Spa', type: 'spa', label: [8, 6], wallFinish: 'paint-white' },
  {
    id: 'stairHall',
    name: 'Stair hall (not labelled)',
    type: 'stair',
    only: 'B',
    floor: 'floor-marble',
    wallFinish: 'paint-cream',
  },
  {
    id: 'terrace',
    name: 'Roof Terrace',
    type: 'outdoor',
    level: 'roof',
    floor: 'decking',
    note: 'The picture shows the ground floor only; the terrace is placed over the left-front wing, reached by the staircase.',
  },
];

interface ZoneT {
  id: string;
  name: string;
  type: string;
  label?: [number, number];
  material?: string;
  covered?: boolean;
  note?: string;
  only?: 'A' | 'B';
}
const ZONES: ZoneT[] = [
  { id: 'lounge', name: 'Garden Lounge', type: 'lawn', label: [18, 14] },
  {
    id: 'pool',
    name: 'Infinity Pool (Organic Shape)',
    type: 'pool',
    label: [22, 14],
    material: 'pool-tile',
  },
  { id: 'firedeck', name: 'Fire-Pit Deck', type: 'deck', material: 'decking' },
  {
    id: 'dining',
    name: 'Outdoor Dining',
    type: 'patio',
    label: [14, 10],
    material: 'decking',
    covered: true,
  },
  { id: 'kids', name: 'Kids Play Area', type: 'play', label: [14, 10], material: 'grass' },
  { id: 'frontgarden', name: 'Front Garden', type: 'lawn', label: [24, 14] },
  { id: 'entrypath', name: 'Entrance Path and Steps', type: 'path', material: 'paving-stone' },
  {
    id: 'parking',
    name: 'Covered Car Parking',
    type: 'parking',
    label: [20, 18],
    covered: true,
    material: 'gravel',
  },
  { id: 'driveway', name: 'Driveway', type: 'path', material: 'gravel' },
  { id: 'sidePlanter', name: 'Side Planter (right wing)', type: 'garden', only: 'A' },
  { id: 'sideGarden', name: 'Side Garden (right wing)', type: 'garden', only: 'A' },
  { id: 'carWall', name: 'Planter strip beside the parking', type: 'garden', only: 'A' },
  {
    id: 'stonepath',
    name: 'Stepping-stone path (garden lounge to the pool)',
    type: 'path',
    material: 'paving-stone',
    only: 'B',
  },
  { id: 'courtL', name: 'Entry Court (left planter)', type: 'garden', only: 'B' },
  { id: 'courtR', name: 'Entry Court (right planter)', type: 'garden', only: 'B' },
];

// Option A: every labelled room exactly its label (feet, before the +2 ft left margin).
const A_ROOMS: Record<string, Shape> = {
  utility: { rect: [4, 18, 6, 8] },
  store: { rect: [4, 26, 6, 4] },
  kitchen: { rect: [10, 18, 16, 12] },
  bed2: { rect: [4, 30, 14, 12] },
  corridorL: {
    polygon: [
      [18, 30],
      [26, 30],
      [26, 79],
      [18, 79],
      [18, 62],
      [22, 62],
      [22, 48],
      [20, 48],
      [20, 42],
      [18, 42],
    ],
  },
  bath2: { rect: [4, 42, 8, 6] },
  closet: { rect: [12, 42, 8, 6] },
  guestL: { rect: [4, 48, 18, 14] },
  ensuite: { rect: [4, 62, 14, 5] },
  bed1: { rect: [4, 67, 14, 12] },
  living: { rect: [26, 30, 18, 28] },
  foyer: { rect: [30, 58, 10, 8] },
  bed3: { rect: [44, 28, 14, 12] },
  bath3: { rect: [58, 28, 8, 6] },
  gaming: { rect: [44, 40, 16, 12] },
  guestR: { rect: [44, 52, 14, 11] },
  bathR: { rect: [58, 52, 8, 5] },
  dressR: { rect: [58, 57, 8, 6] },
  gym: { rect: [52, 4, 14, 12] },
  sauna: { rect: [58, 16, 8, 6] },
  spa: { rect: [58, 22, 8, 6] },
  terrace: { rect: [4, 62, 22, 17] },
};
const A_ZONES: Record<string, Shape> = {
  lounge: { rect: [4, 4, 18, 14] },
  pool: {
    polygon: [
      [22, 4],
      [44, 4],
      [44, 11.5],
      [42.5, 15],
      [39, 17.5],
      [33, 18],
      [28, 16.5],
      [25, 15.5],
      [22.5, 14.5],
      [22, 12],
    ],
  },
  firedeck: { rect: [44, 4, 8, 14] },
  dining: { rect: [26, 18, 14, 10] },
  kids: { rect: [44, 18, 14, 10] },
  frontgarden: { rect: [6, 81, 24, 14] },
  entrypath: { rect: [31, 66, 8, 31] },
  parking: { rect: [46, 63, 20, 18] },
  driveway: { rect: [46, 81, 20, 16] },
  sidePlanter: { rect: [58, 34, 8, 6] },
  sideGarden: { rect: [60, 40, 6, 12] },
  carWall: { rect: [44, 63, 2, 18] },
};
const A_SHIFT = 2;

// Option B: the walls of the picture. Each wall is one named line, read at one or more places on the picture
// (pixels, from 3× enlargements with a 50 px grid). Its plan position is the median of where those readings land after
// the picture is straightened, so two rooms that share a wall share exactly one line, and the spread of the readings
// is the measured uncertainty of the wall (reported when it exceeds half a foot).
type Reading = [number, number];
const V_LINES: Record<string, Reading[]> = {
  lwW: [
    [62, 555],
    [57, 666],
    [57, 776],
    [50, 870],
  ],
  lwWu: [[55, 430]],
  lwW1: [[33, 975]],
  utilK: [[115, 430]],
  bathCl: [[152, 666]],
  bedCorr: [
    [220, 555],
    [220, 666],
  ],
  corrE: [
    [258, 430],
    [258, 555],
    [258, 666],
    [258, 780],
  ],
  ensE: [
    [213, 870],
    [213, 975],
  ],
  stairE: [[280, 940]],
  wingW: [
    [460, 560],
    [460, 670],
    [460, 800],
  ],
  bed3E: [[600, 560]],
  wingE: [
    [676, 555],
    [682, 673],
    [683, 815],
  ],
  guestRE: [[613, 797]],
  gymW: [[550, 276]],
  gymE: [[675, 276]],
  saunaW: [
    [607, 350],
    [607, 437],
  ],
  saunaE: [[682, 350]],
  spaE: [[690, 437]],
};
const H_LINES: Record<string, Reading[]> = {
  kitT: [
    [115, 368],
    [200, 368],
  ],
  kitB: [
    [140, 492],
    [240, 492],
  ],
  b2B: [
    [140, 617],
    [190, 617],
  ],
  guestT: [
    [100, 716],
    [200, 716],
  ],
  guestB: [[150, 837]],
  ensB: [[130, 904]],
  bed1B: [[130, 1043]],
  livT: [[350, 507]],
  livB: [[350, 878]],
  foyB: [[350, 1012]],
  bed3T: [
    [530, 499],
    [640, 499],
  ],
  bed3B: [
    [530, 619],
    [640, 619],
  ],
  bath3B: [[640, 606]],
  gameB: [[560, 727]],
  rGuestB: [[540, 866]],
  bathT: [[650, 767]],
  gymT: [[612, 230]],
  gymB: [[612, 323]],
  saunaB: [[645, 378]],
  spaB: [[645, 499]],
};
interface RoomLines {
  x0: string;
  y0: string;
  x1: string;
  y1: string;
}
const B_ROOMS: Record<string, RoomLines> = {
  utility: { x0: 'lwWu', y0: 'kitT', x1: 'utilK', y1: 'kitB' },
  kitchen: { x0: 'utilK', y0: 'kitT', x1: 'corrE', y1: 'kitB' },
  bed2: { x0: 'lwW', y0: 'kitB', x1: 'bedCorr', y1: 'b2B' },
  corridorL: { x0: 'bedCorr', y0: 'kitB', x1: 'corrE', y1: 'guestT' },
  bath2: { x0: 'lwW', y0: 'b2B', x1: 'bathCl', y1: 'guestT' },
  closet: { x0: 'bathCl', y0: 'b2B', x1: 'bedCorr', y1: 'guestT' },
  guestL: { x0: 'lwW', y0: 'guestT', x1: 'corrE', y1: 'guestB' },
  ensuite: { x0: 'lwW', y0: 'guestB', x1: 'ensE', y1: 'ensB' },
  bed1: { x0: 'lwW1', y0: 'ensB', x1: 'ensE', y1: 'bed1B' },
  terrace: { x0: 'lwW1', y0: 'guestB', x1: 'stairE', y1: 'bed1B' },
  living: { x0: 'corrE', y0: 'livT', x1: 'wingW', y1: 'livB' },
  foyer: { x0: 'foyW', y0: 'livB', x1: 'foyE', y1: 'foyB' },
  bed3: { x0: 'wingW', y0: 'bed3T', x1: 'bed3E', y1: 'bed3B' },
  bath3: { x0: 'bed3E', y0: 'spaB', x1: 'wingE', y1: 'bath3B' },
  gaming: { x0: 'wingW', y0: 'bed3B', x1: 'wingE', y1: 'gameB' },
  guestR: { x0: 'wingW', y0: 'gameB', x1: 'guestRE', y1: 'rGuestB' },
  bathR: { x0: 'guestRE', y0: 'gameB', x1: 'wingE', y1: 'rGuestB' },
  gym: { x0: 'gymW', y0: 'gymT', x1: 'gymE', y1: 'gymB' },
  sauna: { x0: 'saunaW', y0: 'gymB', x1: 'saunaE', y1: 'saunaB' },
  spa: { x0: 'saunaW', y0: 'saunaB', x1: 'spaE', y1: 'spaB' },
};
V_LINES.foyW = [[297, 945]];
V_LINES.foyE = [[402, 945]];
type Box = [number, number, number, number];
const B_ZONES: Record<string, Box | { polygon: Pt[] }> = {
  lounge: [63, 225, 235, 365],
  pool: {
    polygon: [
      [265, 253],
      [442, 253],
      [442, 318],
      [438, 342],
      [420, 358],
      [390, 364],
      [350, 364],
      [320, 358],
      [300, 350],
      [280, 345],
      [265, 335],
    ],
  },
  stonepath: [235, 225, 265, 365],
  firedeck: [445, 250, 548, 392],
  dining: [267, 385, 415, 505],
  kids: [423, 400, 600, 495],
  frontgarden: [23, 1063, 305, 1187],
  entrypath: [310, 1012, 392, 1197],
  parking: PARKING_PX,
  driveway: [452, 1098, 700, 1197],
  courtL: [282, 880, 297, 1010],
  courtR: [402, 880, 452, 1012],
};

// ───────────────────────────── building the geometry of each option ─────────────────────────────

interface Layout {
  rooms: Record<string, Shape>;
  zones: Record<string, Shape>;
  /** The perimeter wall rectangle [x0, y0, x1, y1]. */
  wall: [number, number, number, number];
  stairHall: Shape;
  snapReport: string[];
  /** Where each room or zone is on the picture, in pixels (Option B only). */
  pic: Record<string, [number, number, number, number]>;
}

function layoutA(): Layout {
  const rooms: Record<string, Shape> = {};
  for (const [id, s] of Object.entries(A_ROOMS)) rooms[id] = shift(s, A_SHIFT, 0);
  const zones: Record<string, Shape> = {};
  for (const [id, s] of Object.entries(A_ZONES)) zones[id] = shift(s, A_SHIFT, 0);
  return {
    rooms,
    zones,
    wall: [WALL_INSET, WALL_INSET, PLOT_W - WALL_INSET, PLOT_D - WALL_INSET],
    stairHall: { rect: [A_SHIFT + 18, 62, 8, 17] },
    snapReport: [],
    pic: {},
  };
}

/**
 * The picture is a rendering, not a survey: its walls are not exactly straight or parallel. The four corners that
 * straighten it are fitted so that the named walls below come out as straight, axis-aligned lines as closely as the
 * picture allows (least squares over every reading), starting from the plot wall of the picture.
 */
function fitCorners(): void {
  const cost = (): number => {
    let sum = 0;
    const spread = (vals: number[]) => {
      const t = [...vals].sort((a, b) => a - b);
      const m = t[Math.floor(t.length / 2)]!;
      return vals.reduce((s, v) => s + (v - m) ** 2, 0);
    };
    for (const reads of Object.values(V_LINES)) sum += spread(reads.map(([x, y]) => P(x, y)[0]));
    for (const reads of Object.values(H_LINES)) sum += spread(reads.map(([x, y]) => P(x, y)[1]));
    return sum;
  };
  let best = cost();
  for (const step of [12, 6, 3, 1.5, 0.75]) {
    let improved = true;
    for (let round = 0; improved && round < 40; round++) {
      improved = false;
      for (let i = 0; i < 4; i++)
        for (const axis of [0, 1] as const)
          for (const dir of [-1, 1]) {
            const next = PIC_CORNERS.map((c) => [...c] as Pt);
            next[i]![axis] += dir * step;
            const keep = PIC_CORNERS;
            remap(next);
            const c = cost();
            if (c < best - 1e-9) {
              best = c;
              improved = true;
            } else remap(keep);
          }
    }
  }
}

function layoutB(): Layout {
  const report: string[] = [];
  const median = (v: number[]) => {
    const t = [...v].sort((p, q) => p - q);
    return t[Math.floor(t.length / 2)]!;
  };
  const vx = new Map<string, number>();
  for (const [name, reads] of Object.entries(V_LINES)) {
    const xs = reads.map(([x, y]) => P(x, y)[0]);
    const m = q25(median(xs));
    vx.set(name, m);
    const spread = Math.max(...xs.map((x) => Math.abs(x - m)));
    if (spread > 0.5)
      report.push(
        `wall ${name}: readings are up to ${spread.toFixed(2)} ft from the wall as drawn`,
      );
  }
  const hy = new Map<string, number>();
  for (const [name, reads] of Object.entries(H_LINES)) {
    const ys = reads.map(([x, y]) => P(x, y)[1]);
    const m = q25(median(ys));
    hy.set(name, m);
    const spread = Math.max(...ys.map((y) => Math.abs(y - m)));
    if (spread > 0.5)
      report.push(
        `wall ${name}: readings are up to ${spread.toFixed(2)} ft from the wall as drawn`,
      );
  }
  const rooms: Record<string, Shape> = {};
  for (const [id, l] of Object.entries(B_ROOMS)) {
    const x0 = vx.get(l.x0)!;
    const x1 = vx.get(l.x1)!;
    const y0 = hy.get(l.y0)!;
    const y1 = hy.get(l.y1)!;
    rooms[id] = { rect: [x0, y0, x1 - x0, y1 - y0] };
  }
  // The stair hall is L-shaped: narrow under the guest room, wider where the staircase rises beside the living room.
  rooms.stairHall = {
    polygon: [
      [vx.get('ensE')!, hy.get('guestB')!],
      [vx.get('corrE')!, hy.get('guestB')!],
      [vx.get('corrE')!, hy.get('livB')!],
      [vx.get('stairE')!, hy.get('livB')!],
      [vx.get('stairE')!, hy.get('bed1B')!],
      [vx.get('ensE')!, hy.get('bed1B')!],
    ],
  };
  const stairHall = rooms.stairHall;

  const zones: Record<string, Shape> = {};
  for (const [id, b] of Object.entries(B_ZONES)) {
    if (Array.isArray(b)) {
      const r = boxToRect(b);
      zones[id] = { rect: [q25(r[0]), q25(r[1]), q25(r[2]), q25(r[3])] };
    } else zones[id] = { polygon: b.polygon.map(([x, y]) => P(x, y).map(q25) as Pt) };
  }
  // Where each room is on the picture: for each of its four walls, the reading taken nearest the room itself.
  const mean = (reads: Reading[], axis: 0 | 1) =>
    reads.reduce((sum, r) => sum + r[axis], 0) / reads.length;
  const nearest = (reads: Reading[], along: 0 | 1, at: number, across: 0 | 1) =>
    reads.reduce(
      (best, r) => (Math.abs(r[along] - at) < Math.abs(best[along] - at) ? r : best),
      reads[0]!,
    )[across];
  const pic: Record<string, [number, number, number, number]> = {};
  for (const [id, l] of Object.entries(B_ROOMS)) {
    const midX = (mean(V_LINES[l.x0]!, 0) + mean(V_LINES[l.x1]!, 0)) / 2;
    const midY = (mean(H_LINES[l.y0]!, 1) + mean(H_LINES[l.y1]!, 1)) / 2;
    pic[id] = [
      nearest(V_LINES[l.x0]!, 1, midY, 0),
      nearest(H_LINES[l.y0]!, 0, midX, 1),
      nearest(V_LINES[l.x1]!, 1, midY, 0),
      nearest(H_LINES[l.y1]!, 0, midX, 1),
    ];
  }
  for (const [id, b] of Object.entries(B_ZONES)) if (Array.isArray(b)) pic[id] = b;
  const wallRect: [number, number, number, number] = [
    B_ORIGIN[0],
    B_ORIGIN[1],
    B_ORIGIN[0] + CAL.width,
    B_ORIGIN[1] + CAL.depth,
  ];
  return { rooms, zones, wall: wallRect, stairHall, snapReport: report, pic };
}

// ───────────────────────────── furnishing ─────────────────────────────

const WALL_GAP = 0.9;
type Side = 'n' | 's' | 'e' | 'w';
const ROT: Record<Side, number> = { n: 0, s: 180, w: 270, e: 90 };

class Furnisher {
  items: Item[] = [];
  lines: NonNullable<Design['lines']> = [];
  constructor(
    private design: 'A' | 'B',
    private levelHeight: number,
  ) {}

  add(catalog: string, x: number, y: number, rot = 0, o: Partial<Item> = {}): void {
    this.items.push({
      catalog,
      at: [Math.round(x * 20) / 20, Math.round(y * 20) / 20],
      rotation: rot,
      props: {},
      ...o,
    } as Item);
  }

  /** An item standing against a wall `side` of `r`, `along` ft from the wall's start (left/top), `depth` ft deep. */
  onWall(
    catalog: string,
    r: Rect,
    side: Side,
    along: number,
    depth: number,
    o: Partial<Item> = {},
    gap = WALL_GAP,
  ): void {
    const [x, y, w, d] = r;
    const at: Pt =
      side === 'n'
        ? [x + along, y + gap + depth / 2]
        : side === 's'
          ? [x + along, y + d - gap - depth / 2]
          : side === 'w'
            ? [x + gap + depth / 2, y + along]
            : [x + w - gap - depth / 2, y + along];
    this.add(catalog, at[0], at[1], ROT[side], o);
  }

  inventory(tag: string, o: Partial<Item> = {}): Partial<Item> {
    return { inventory: tag, ...o };
  }

  ceiling(catalog: string, x: number, y: number, o: Partial<Item> = {}): void {
    this.add(catalog, x, y, 0, o);
  }

  /** Lights on a grid inside a polygon. */
  lightGrid(poly: Pt[], step: number, catalog = 'downlight', inventory?: string): void {
    const [bx, by, bw, bd] = bbox({ polygon: poly });
    let placed = 0;
    for (let yy = by + step / 2; yy < by + bd; yy += step)
      for (let xx = bx + step / 2; xx < bx + bw; xx += step)
        if (inPoly([xx, yy], poly)) {
          this.add(catalog, xx, yy, 0, inventory ? { inventory } : {});
          placed++;
        }
    if (!placed) {
      // a narrow hall that fell between the grid lines still gets its light
      const c: Pt = [bx + bw / 2, by + bd / 2];
      if (inPoly(c, poly)) this.add(catalog, c[0], c[1], 0, inventory ? { inventory } : {});
    }
  }
}

const plantProps = (species = 'fern') => ({ species });

function furnishRoom(f: Furnisher, id: string, shape: Shape, design: 'A' | 'B'): void {
  const r = bbox(shape);
  const [x, y, w, d] = r;
  const cx = x + w / 2;
  const cy = y + d / 2;
  const isB = design === 'B';
  const size = (c: string) => S(c);
  const inv = (t: string) => ({ inventory: t });

  const bedroom = (
    bedSide: Side,
    bed: string,
    extra: { tv?: boolean; desk?: boolean; wardrobeSide?: Side } = {},
  ) => {
    const b = size(bed);
    const across = bedSide === 'n' || bedSide === 's' ? w / 2 : d / 2;
    f.onWall(bed, r, bedSide, across, b.d, {
      props: { color: '#2f5d50', frameColor: '#5b3f27' },
      ...inv(`Bed (${id})`),
    });
    // bedside tables on both sides of the head
    const off = b.w / 2 + 1.1;
    for (const k of [-1, 1])
      f.onWall('side-table', r, bedSide, across + k * off, 1.3, inv(`Bedside tables (${id})`));
    for (const k of [-1, 1])
      f.onWall('table-lamp', r, bedSide, across + k * off, 1.0, {
        elevation: 1.65,
        ...inv(`Bedside lamps (${id})`),
      });
    // rug under the foot of the bed
    const rugAt: Pt =
      bedSide === 'n'
        ? [cx, y + b.d + 0.4 + 2]
        : bedSide === 's'
          ? [cx, y + d - b.d - 2.4]
          : bedSide === 'w'
            ? [x + b.d + 2.4, cy]
            : [x + w - b.d - 2.4, cy];
    const rugRot = bedSide === 'n' || bedSide === 's' ? 0 : 90;
    f.add('rug', rugAt[0], rugAt[1], rugRot, {
      size: [8, 5.5, 0.05],
      props: { color: '#8a7d6a' },
      ...inv(`Rugs (${id})`),
    });
    // wardrobe on the opposite wall
    const opposite: Side = { n: 's', s: 'n', w: 'e', e: 'w' }[bedSide] as Side;
    const wSide = extra.wardrobeSide ?? opposite;
    const wardLen = wSide === 'n' || wSide === 's' ? Math.min(w - 4, 6) : Math.min(d - 4, 6);
    f.onWall('wardrobe', r, wSide, wSide === 'n' || wSide === 's' ? w * 0.28 : d * 0.28, 2, {
      size: [wardLen, 2, 7.2],
      ...inv(`Wardrobe (${id})`),
    });
    if (extra.tv !== false)
      f.onWall(
        'tv-unit',
        r,
        opposite,
        opposite === 'n' || opposite === 's' ? w * 0.72 : d * 0.72,
        1.4,
        inv(`TV unit (${id})`),
      );
    // reading corner
    const corner: Pt =
      bedSide === 'w' || bedSide === 'n' ? [x + w - 2.2, y + d - 2.0] : [x + 2.2, y + d - 2.0];
    f.add('armchair', corner[0], corner[1], 0, {
      props: { color: '#6b8e7a' },
      ...inv(`Armchair (${id})`),
    });
    f.add('plant-medium', corner[0] + (corner[0] > cx ? -2.4 : 2.4), corner[1] + 0.2, 0, {
      props: plantProps(),
      ...inv(`House plants (${id})`),
    });
    f.ceiling('ceiling-light', cx, cy, inv(`Ceiling lights (${id})`));
  };

  const bathroom = (opts: { tub?: boolean } = {}) => {
    const wc = size('wc');
    f.onWall('wc', r, 'n', w * 0.25, wc.d, inv(`Bathroom fittings (${id})`));
    f.onWall('basin', r, 'n', w * 0.62, 1.6, inv(`Bathroom fittings (${id})`));
    f.onWall('mirror', r, 'n', w * 0.62, 0.1, {
      elevation: 3.6,
      ...inv(`Bathroom fittings (${id})`),
    });
    if (opts.tub && w >= 9)
      f.onWall('bathtub', r, 's', w * 0.35, 2.5, inv(`Bathroom fittings (${id})`));
    f.onWall('shower', r, 'e', d * 0.62, 3, inv(`Bathroom fittings (${id})`));
    f.ceiling('ceiling-light', cx, cy, inv(`Ceiling lights (${id})`));
  };

  switch (id) {
    case 'kitchen': {
      const sink = size('sink-kitchen');
      const stove = size('stove');
      const fridge = size('fridge');
      const L = w - 2 * WALL_GAP - fridge.w - sink.w - stove.w;
      const runW = L > 2.4 ? L / 2 : 0;
      let ax = WALL_GAP;
      const put = (c: string, ww: number, o: Partial<Item> = {}) => {
        f.onWall(c, r, 'n', ax + ww / 2, 2, {
          ...inv('Kitchen cabinets, sink, hob and fridge'),
          ...o,
        });
        ax += ww;
      };
      put('fridge', fridge.w, { size: [fridge.w, 2.3, 6] });
      if (runW) put('kitchen-base-run', runW / 1, { size: [runW, 2, 3] });
      put('sink-kitchen', sink.w);
      if (runW) put('kitchen-base-run', runW, { size: [runW, 2, 3] });
      put('stove', stove.w);
      // wall cabinets above the counter
      const cab = (w - 2 * WALL_GAP - fridge.w) / 3;
      for (let i = 0; i < 3; i++)
        f.onWall('kitchen-wall-cabinet', r, 'n', WALL_GAP + fridge.w + cab * (i + 0.5), 1.15, {
          size: [cab - 0.2, 1.15, 2.3],
          ...inv('Kitchen wall cabinets'),
        });
      f.add('kitchen-island', cx, cy + 1.2, 0, {
        props: { stools: true },
        ...inv('Kitchen island with stools'),
      });
      for (const k of [-1, 1])
        f.ceiling('pendant-light', cx + k * 1.8, cy + 1.2, inv('Pendant lights'));
      f.add('plant-medium', x + w - 1.6, y + d - 1.6, 0, {
        props: plantProps(),
        ...inv('House plants (kitchen)'),
      });
      f.ceiling('ceiling-light', cx, y + d * 0.35, inv('Ceiling lights'));
      break;
    }
    case 'utility': {
      f.onWall('washing-machine', r, 'n', w * 0.3, 2, inv('Washing machine and dryer'));
      f.onWall('washing-machine', r, 'n', w * 0.72, 2, inv('Washing machine and dryer'));
      f.onWall('kitchen-base-run', r, 'w', d * 0.62, 2, {
        size: [Math.max(2, d * 0.45), 2, 3],
        ...inv('Utility counter'),
      });
      f.add('plant-small', x + w - 1.2, y + d - 1.2, 0, {
        props: plantProps(),
        ...inv('House plants (utility)'),
      });
      f.ceiling('ceiling-light', cx, cy, inv('Ceiling lights'));
      break;
    }
    case 'store': {
      f.onWall('closet-shelving', r, 'n', w / 2, 1.8, {
        size: [Math.min(w - 1, 5), 1.8, 7],
        ...inv('Walk-in closet shelving'),
      });
      f.ceiling('ceiling-light', cx, cy, inv('Ceiling lights'));
      break;
    }
    case 'bed2':
      bedroom('n', 'bed-queen');
      break;
    case 'guestL':
      bedroom('w', 'bed-queen');
      break;
    case 'bed1':
      bedroom('w', 'bed-king');
      break;
    case 'bed3':
      bedroom('n', 'bed-king');
      break;
    case 'guestR':
      bedroom('n', 'bed-queen', { tv: false });
      break;
    case 'bath2':
    case 'bath3':
    case 'bathR':
      bathroom();
      break;
    case 'ensuite': {
      f.onWall('bathtub', r, 'n', w * 0.2, 2.5, inv('Bathroom fittings (guest ensuite)'));
      f.onWall('wc', r, 'n', w * 0.52, 2.4, inv('Bathroom fittings (guest ensuite)'));
      f.onWall('basin', r, 'n', w * 0.7, 1.6, inv('Bathroom fittings (guest ensuite)'));
      f.onWall('mirror', r, 'n', w * 0.7, 0.1, {
        elevation: 3.6,
        ...inv('Bathroom fittings (guest ensuite)'),
      });
      f.onWall('shower', r, 'n', w * 0.88, 3, inv('Bathroom fittings (guest ensuite)'));
      f.ceiling('ceiling-light', cx, cy, inv('Ceiling lights'));
      break;
    }
    case 'closet': {
      f.onWall('closet-shelving', r, 's', w / 2, 1.8, {
        size: [Math.min(w - 1.6, 6.6), 1.8, 7],
        ...inv('Walk-in closet shelving'),
      });
      f.onWall('closet-shelving', r, 'w', d / 2, 1.8, {
        size: [Math.min(d - 1.6, 5), 1.8, 7],
        ...inv('Walk-in closet shelving'),
      });
      f.add('plant-small', x + w - 1.3, y + 1.3, 0, {
        props: plantProps(),
        ...inv('House plants (closet)'),
      });
      f.ceiling('ceiling-light', cx, cy, inv('Ceiling lights'));
      break;
    }
    case 'dressR': {
      f.onWall('closet-shelving', r, 'n', w / 2, 1.8, {
        size: [Math.min(w - 1.6, 6.6), 1.8, 7],
        ...inv('Walk-in closet shelving'),
      });
      f.ceiling('ceiling-light', cx, cy, inv('Ceiling lights'));
      break;
    }
    case 'living': {
      // dining at the back (north) end, lounge in front of it
      f.add('dining-table-8', cx, y + 5.2, 0, {
        props: { chairColor: '#44403c' },
        ...inv('8-seat dining table'),
      });
      for (const k of [-2.2, 0, 2.2])
        f.ceiling('pendant-light', cx + k, y + 5.2, inv('Pendant lights over the dining table'));
      f.add('rug', cx, cy + d * 0.12, 90, {
        size: [Math.min(11, w - 3), 8, 0.05],
        props: { color: '#6f6a62' },
        ...inv('Living room rug'),
      });
      f.add('sofa-u', cx + 0.4, cy + d * 0.12, 90, {
        props: { color: '#e4dccd' },
        ...inv('U-shaped sectional sofa'),
      });
      f.add('coffee-table', cx - 0.4, cy + d * 0.12, 0, {
        props: { shape: 'round' },
        size: [3.4, 3.4, 1.3],
        ...inv('Coffee table'),
      });
      f.onWall('tv-wall-unit', r, 'w', cy + d * 0.12 - y, 1.4, inv('TV wall'));
      for (const [px, py] of [
        [x + 1.7, y + 2.2],
        [x + w - 1.7, y + 2.2],
        [x + 1.7, y + d * 0.42],
        [x + w - 1.7, y + d * 0.42],
        [x + 1.7, y + d - 2],
        [x + w - 1.7, y + d - 2],
      ] as Pt[])
        f.add('plant-large', px, py, 0, {
          props: plantProps('palm'),
          ...inv('Potted palms along the living room'),
        });
      for (const k of [-1, 1])
        f.add('floor-lamp', cx + k * 5, cy + d * 0.12 - 5.2, 0, inv('Floor lamps'));
      f.lightGrid(polyOf(shape), 9, 'downlight', 'Recessed ceiling lights');
      break;
    }
    case 'foyer': {
      f.add('floor-medallion', cx, cy, 0, {
        size: [Math.min(w, d) - 1.6, Math.min(w, d) - 1.6, 0.07],
        ...inv('Floor medallion in the foyer'),
      });
      f.onWall('side-table', r, 'w', d * 0.4, 1.3, inv('Foyer console tables'));
      f.onWall('side-table', r, 'e', d * 0.4, 1.3, inv('Foyer console tables'));
      f.onWall('vase-bowl', r, 'w', d * 0.4, 1, { elevation: 1.6, ...inv('Foyer console tables') });
      f.add('plant-large', x + 1.5, y + d * 0.2, 0, {
        props: plantProps('palm'),
        ...inv('Potted palms at the entrance'),
      });
      f.add('plant-large', x + w - 1.5, y + d * 0.2, 0, {
        props: plantProps('palm'),
        ...inv('Potted palms at the entrance'),
      });
      f.ceiling('pendant-light', cx, cy, inv('Pendant lights'));
      break;
    }
    case 'stairHall':
    case 'corridorL': {
      f.lightGrid(polyOf(shape), 6, 'downlight', 'Corridor lights');
      break;
    }
    case 'gaming': {
      const desk = size('gaming-desk');
      for (const k of [-1, 1])
        f.onWall('gaming-desk', r, 'n', w / 2 + k * (desk.w / 2 + 0.4), desk.d, {
          props: { color: '#0f172a' },
          ...inv('Gaming desks and monitors'),
        });
      for (const k of [-1, 1])
        f.add('office-chair', cx + k * (desk.w / 2 + 0.4), y + WALL_GAP + desk.d + 1.4, 180, {
          props: { color: '#1d4ed8' },
          ...inv('Gaming chairs'),
        });
      f.onWall('theatre-screen', r, 'e', d / 2, 0.2, {
        size: [Math.min(8, d - 2), 0.3, 4.5],
        ...inv('Wall screen'),
      });
      f.onWall('neon-strip', r, 'n', w * 0.2, 0.2, {
        size: [4, 0.15, 0.3],
        elevation: 6.4,
        props: { color: '#c026d3' },
        ...inv('Neon strip lights'),
      });
      f.onWall('neon-strip', r, 'n', w * 0.5, 0.2, {
        size: [5, 0.15, 0.3],
        elevation: 7.2,
        props: { color: '#38bdf8' },
        ...inv('Neon strip lights'),
      });
      f.onWall('neon-strip', r, 'n', w * 0.8, 0.2, {
        size: [4, 0.15, 0.3],
        elevation: 6.4,
        props: { color: '#6366f1' },
        ...inv('Neon strip lights'),
      });
      f.onWall('neon-strip', r, 'w', d * 0.55, 0.2, {
        size: [5, 0.15, 0.3],
        elevation: 3,
        props: { color: '#ec4899' },
        ...inv('Neon strip lights'),
      });
      f.add('sofa-2seat', x + w - 3.2, y + d - 3.4, 90, {
        props: { color: '#312e81' },
        ...inv('Gaming lounge seating'),
      });
      f.add('rug', cx, cy + 1, 0, {
        size: [Math.min(11, w - 2), 6, 0.05],
        props: { color: '#1e1b4b' },
        ...inv('Gaming room rug'),
      });
      f.ceiling('ceiling-light', cx, cy, { props: { color: '#a78bfa' }, ...inv('Ceiling lights') });
      break;
    }
    case 'gym': {
      const tm = size('treadmill');
      f.onWall('treadmill', r, 'n', w * 0.3, tm.d, inv('Gym equipment'));
      f.onWall('treadmill', r, 'n', w * 0.5, tm.d, inv('Gym equipment'));
      f.onWall('gym-rack', r, 'e', d * 0.4, S('gym-rack').d, inv('Gym equipment'));
      f.add('gym-bench', cx - 1.5, cy + 1.6, 0, inv('Gym equipment'));
      f.add('gym-bench', cx + 1.3, cy + 1.6, 0, inv('Gym equipment'));
      f.onWall('mirror', r, 'w', d * 0.5, 0.1, {
        elevation: 2.6,
        size: [6, 0.1, 4],
        ...inv('Gym mirror wall'),
      });
      f.lightGrid(polyOf(shape), 6, 'downlight', 'Recessed ceiling lights');
      break;
    }
    case 'sauna': {
      f.onWall('sauna-bench', r, 'n', w / 2, S('sauna-bench').d, {
        size: [Math.min(w - 1.8, 6.6), 3.5, 3.6],
        ...inv('Sauna benches'),
      });
      f.onWall('sauna-bench', r, 'e', d / 2, 2, {
        size: [Math.min(d - 1.8, 4), 2, 2.2],
        ...inv('Sauna benches'),
      });
      f.ceiling('ceiling-light', cx, cy, { props: { kelvin: 2200 }, ...inv('Ceiling lights') });
      break;
    }
    case 'spa': {
      f.add('spa-tub', cx, cy + 0.2, 0, {
        size: [Math.min(6, w - 1.6), Math.min(3.4, d - 1.4), 2],
        ...inv('Spa tub'),
      });
      f.add('plant-small', x + 1.2, y + d - 1.1, 0, {
        props: plantProps(),
        ...inv('House plants (spa)'),
      });
      f.ceiling('ceiling-light', cx, cy, inv('Ceiling lights'));
      break;
    }
    case 'terrace': {
      const up = { level: 'roof' };
      f.add('lounge-set', cx - 4, cy - 2, 0, { ...up, ...inv('Roof terrace lounge') });
      f.add('sun-lounger', cx + 3.5, cy - 3, 0, { ...up, ...inv('Roof terrace lounge') });
      f.add('sun-lounger', cx + 5.2, cy - 3, 0, { ...up, ...inv('Roof terrace lounge') });
      for (const k of [-1, 1])
        f.add('planter-box', cx + k * 4, y + 1.4, 0, { ...up, ...inv('Roof terrace planters') });
      break;
    }
    default:
      break;
  }
  void isB;
}

/** Outdoor furniture and planting tied to a zone. */
function furnishZone(f: Furnisher, id: string, shape: Shape): void {
  const r = bbox(shape);
  const [x, y, w, d] = r;
  const cx = x + w / 2;
  const cy = y + d / 2;
  const inv = (t: string) => ({ inventory: t });
  switch (id) {
    case 'lounge': {
      f.add('pergola', cx, y + 2.1, 0, {
        size: [Math.min(w - 1, 16), 5.4, 8.5],
        ...inv('Pergola over the garden lounge'),
      });
      f.add('sofa-l', cx - 1.8, cy + 0.6, 0, {
        size: [8.2, 5.6, 2.8],
        props: { color: '#e5dccf' },
        ...inv('Garden lounge sofa set'),
      });
      f.add('sofa-l', cx + 3.6, cy + 0.6, 90, {
        size: [8.2, 5.6, 2.8],
        props: { color: '#e5dccf' },
        ...inv('Garden lounge sofa set'),
      });
      f.add('fire-pit', cx + 0.9, cy + 0.5, 0, { ...inv('Fire table in the garden lounge') });
      for (let i = 0; i < 4; i++)
        f.add('flower-bed', x + 1.5 + (i * (w - 3)) / 3, y + d - 1.1, 0, {
          props: { color: i % 2 ? '#e11d74' : '#f59e0b' },
          ...inv('Flower beds'),
        });
      for (let i = 0; i < 3; i++)
        f.add('shrub', x + 1.1, y + 4 + i * 2.6, 0, { ...inv('Flower beds') });
      break;
    }
    case 'dining': {
      f.add('pergola', cx, y + 2.4, 0, {
        size: [Math.min(w - 1, 12), 5, 8.5],
        ...inv('Pergola over the outdoor dining'),
      });
      f.add('dining-table-6', cx, cy + 1, 0, {
        props: { chairColor: '#44403c' },
        ...inv('Outdoor dining table and chairs'),
      });
      for (const k of [-1, 1])
        f.ceiling('pendant-light', cx + k * 1.8, cy + 1, {
          elevation: 5.5,
          ...inv('Pendant lights'),
        });
      f.add('plant-large', x + 1.2, y + d - 1.4, 0, {
        props: plantProps('palm'),
        ...inv('Potted palms (outdoor dining)'),
      });
      f.add('plant-large', x + w - 1.2, y + d - 1.4, 0, {
        props: plantProps('palm'),
        ...inv('Potted palms (outdoor dining)'),
      });
      break;
    }
    case 'pool': {
      f.add('waterfall-wall', cx + w * 0.12, y + 0.9, 0, {
        size: [Math.min(8, w * 0.5), 1.4, 7.5],
        ...inv('Waterfall wall feature'),
      });
      f.add('planted-island', x + 3.2, y + d * 0.55, 0, {
        size: [4.2, 3.8, 3.6],
        ...inv('Planted island in the pool'),
      });
      f.add('pool-ladder', x + w - 1.5, y + 2.2, 0, inv('Pool ladders'));
      f.add('pool-ladder', x + w - 1.5, y + d * 0.55, 0, inv('Pool ladders'));
      break;
    }
    case 'firedeck': {
      f.add('fire-pit-deck', cx, y + 4.6, 0, {
        size: [Math.min(w - 0.8, 7.4), Math.min(w - 0.8, 7.4), 2.4],
        ...inv('Fire-pit deck'),
      });
      f.add('sun-lounger', cx - 1.4, y + d - 4.2, 20, { ...inv('Two sun loungers on the deck') });
      f.add('sun-lounger', cx + 1.4, y + d - 3.6, 20, { ...inv('Two sun loungers on the deck') });
      break;
    }
    case 'kids': {
      f.add('trampoline', x + w * 0.27, y + d * 0.5, 0, {
        size: [4, 4, 3],
        props: { color: '#1e3a8a' },
        ...inv('Trampoline'),
      });
      f.add('play-frame', x + w * 0.74, y + d * 0.42, 180, {
        size: [5.6, 4.2, 6.5],
        ...inv('Play tower with slide'),
      });
      f.add('shrub', x + w - 1, y + d - 1.2, 0, inv('Planting around the play area'));
      f.add('shrub', x + w - 1, y + 1.2, 0, inv('Planting around the play area'));
      f.add('shrub', x + 1, y + d - 1.2, 0, inv('Planting around the play area'));
      break;
    }
    case 'frontgarden': {
      f.add('sofa-curved', x + w * 0.2, cy, 270, {
        size: [6.5, 4.4, 2.6],
        ...inv('Curved garden sofa'),
      });
      f.add('fountain-square', x + w * 0.52, cy, 0, {
        size: [Math.min(7, d - 1.4), Math.min(7, d - 1.4), 4.6],
        ...inv('Square fountain'),
      });
      for (let i = 0; i < 5; i++)
        f.add('flower-bed', x + 2 + (i * (w - 4)) / 4, y + 0.9, 0, {
          props: { color: ['#e11d74', '#f59e0b', '#dc2626', '#a855f7', '#f97316'][i]! },
          ...inv('Flower beds in the front garden'),
        });
      f.add('shrub', x + w - 1.6, y + d - 1.4, 0, inv('Flower beds in the front garden'));
      f.add('tree-palm', x + 1.8, y + d - 1.6, 0, inv('Palms in the front garden'));
      f.add('tree-small', x + 2.6, y + 2.6, 0, inv('Shade trees'));
      break;
    }
    case 'parking': {
      const lane = w / 2;
      f.add('car', x + lane * 0.5 + 0.3, cy - 0.5, 0, {
        size: [6.4, 15, 5],
        props: { color: '#f4f4f5' },
        ...inv('White SUV'),
      });
      f.add('car', x + lane * 1.5 - 0.3, cy - 0.5, 0, {
        size: [6.4, 15, 5],
        props: { color: '#18181b' },
        ...inv('Black SUV'),
      });
      for (const k of [0.15, 0.85])
        f.add('garden-light', x + w * k, y + 1, 0, inv('Garden lights'));
      break;
    }
    case 'driveway': {
      f.add('gate-vehicle', x + Math.min(w, 17) / 2 + (w - Math.min(w, 17)) / 2, y + 0.2, 0, {
        size: [Math.min(w - 1, 16), 0.35, 4.6],
        ...inv('Sliding gate of the car port'),
      });
      break;
    }
    case 'entrypath': {
      for (let yy = y + 3; yy < y + d - 1; yy += 6) {
        f.add('garden-light', x + 0.4, yy, 0, inv('Garden lights'));
        f.add('garden-light', x + w - 0.4, yy, 0, inv('Garden lights'));
      }
      break;
    }
    default:
      break;
  }
}

// ───────────────────────────── doors, windows, walls ─────────────────────────────

interface Conn {
  a: string;
  b: string;
  kind?: 'door' | 'archway';
  style?: string;
  width?: number;
  frac?: number;
  tag?: string;
  only?: 'A' | 'B';
}
const CONNECTIONS: Conn[] = [
  { a: 'foyer', b: 'living', kind: 'archway', width: 6.5, tag: 'Foyer opening to the living room' },
  { a: 'living', b: 'corridorL', frac: 0.2 },
  { a: 'living', b: 'bed3', frac: 0.55 },
  { a: 'living', b: 'gaming', frac: 0.5 },
  { a: 'living', b: 'guestR', frac: 0.5 },
  { a: 'bed3', b: 'bath3', frac: 0.5 },
  { a: 'bath3', b: 'spa', frac: 0.5 },
  { a: 'spa', b: 'sauna', frac: 0.5 },
  { a: 'sauna', b: 'gym', frac: 0.5 },
  { a: 'guestR', b: 'dressR', frac: 0.5, only: 'A' },
  { a: 'dressR', b: 'bathR', frac: 0.5, only: 'A' },
  { a: 'guestR', b: 'bathR', frac: 0.5, only: 'B' },
  { a: 'corridorL', b: 'kitchen', frac: 0.7, width: 3.5 },
  { a: 'kitchen', b: 'utility', frac: 0.5 },
  { a: 'store', b: 'utility', frac: 0.5, only: 'A' },
  { a: 'store', b: 'kitchen', frac: 0.5, only: 'A' },
  { a: 'corridorL', b: 'bed2', frac: 0.7 },
  { a: 'bed2', b: 'bath2', frac: 0.5 },
  { a: 'closet', b: 'corridorL', frac: 0.5 },
  { a: 'corridorL', b: 'guestL', frac: 0.5 },
  { a: 'guestL', b: 'ensuite', frac: 0.35 },
  { a: 'corridorL', b: 'bed1', frac: 0.5, only: 'A' },
  { a: 'stairHall', b: 'guestL', frac: 0.6, only: 'B' },
  { a: 'stairHall', b: 'bed1', frac: 0.5, only: 'B' },
  { a: 'bath2', b: 'closet', frac: 0.5 },
];

const WINDOWED = new Set(['bedroom', 'kitchen', 'living', 'gym', 'utility', 'bathroom', 'pantry']);

/** The floor a door swings across: a rectangle [x0, y0, x1, y1] in feet. */
type Swing = [number, number, number, number];
/** A door swing and the index (in the list of openings) of its door. */
type DoorSwing = { zone: Swing; opening: number };

const SMALL_TYPES = new Set(['bathroom', 'sauna', 'spa', 'walk-in-closet', 'pantry', 'utility']);

function buildOpenings(
  rooms: Record<string, Shape>,
  design: 'A' | 'B',
  zones: Record<string, Shape>,
  solids: Swing[],
): { openings: Opening[]; swings: DoorSwing[] } {
  const out: Opening[] = [];
  const swings: DoorSwing[] = [];
  const swing = (opening: number, at: Pt, dir: Pt, width: number, double = false) => {
    const along = width / 2 + 0.2;
    const across = (double ? width / 2 : width) + 0.3;
    const horizontal = Math.abs(dir[0]) > Math.abs(dir[1]);
    swings.push({
      opening,
      zone: horizontal
        ? [at[0] - along, at[1] - across, at[0] + along, at[1] + across]
        : [at[0] - across, at[1] - along, at[0] + across, at[1] + along],
    });
  };
  const warn = (m: string) => console.warn(`[${design}] ${m}`);
  const roomPolys = Object.entries(rooms)
    .filter(([id]) => id !== 'terrace')
    .map(([id, s]) => [id, polyOf(s)] as [string, Pt[]]);
  const doorSpots: Pt[] = [];
  for (const c of CONNECTIONS) {
    if (c.only && c.only !== design) continue;
    const sa = rooms[c.a];
    const sb = rooms[c.b];
    if (!sa || !sb) continue;
    const seg = sharedSegment(polyOf(sa), polyOf(sb));
    if (!seg || seg.len < 2.4) {
      warn(`no shared wall for a door between ${c.a} and ${c.b}`);
      continue;
    }
    const width = Math.min(c.width ?? (c.kind === 'archway' ? 6 : 3), seg.len - 0.8);
    // Small rooms (baths, closets, the sauna …) get pocket doors, which do not swing.
    const typeOf = (id: string) => ROOMS.find((r) => r.id === id)?.type ?? '';
    const pocket =
      c.kind !== 'archway' &&
      !c.style &&
      (SMALL_TYPES.has(typeOf(c.a)) || SMALL_TYPES.has(typeOf(c.b)));
    const dir: Pt = [seg.q[0] - seg.p[0], seg.q[1] - seg.p[1]];
    const clampT = (v: number) =>
      Math.min(1 - (width / 2 + 0.4) / seg.len, Math.max((width / 2 + 0.4) / seg.len, v));
    const spot = (t: number): Pt => [
      seg.p[0] + (seg.q[0] - seg.p[0]) * t,
      seg.p[1] + (seg.q[1] - seg.p[1]) * t,
    ];
    const zoneAt = (at: Pt): Swing => {
      const along = width / 2 + 0.2;
      const across = width + 0.3;
      return Math.abs(dir[0]) > Math.abs(dir[1])
        ? [at[0] - along, at[1] - across, at[0] + along, at[1] + across]
        : [at[0] - across, at[1] - along, at[0] + across, at[1] + along];
    };
    // The wanted spot, or the nearest one that is clear of furniture.
    let t = clampT(c.frac ?? 0.5);
    if (!pocket && c.kind !== 'archway') {
      const candidates = [c.frac ?? 0.5, 0.5, 0.25, 0.75, 0.15, 0.85, 0.35, 0.65].map(clampT);
      t = candidates.find((v) => !solids.some((b) => hit(b, zoneAt(spot(v)), 0.25))) ?? t;
    }
    const at = spot(t);
    doorSpots.push(at);
    if (c.kind !== 'archway' && !pocket) swing(out.length, at, dir, width);
    out.push({
      at: [q25(at[0]), q25(at[1])],
      kind: c.kind ?? 'door',
      style: c.style ?? (c.kind === 'archway' ? 'archway' : pocket ? 'door-pocket' : 'door-single'),
      ...(pocket ? { swing: 'none' } : {}),
      width,
      ...(c.tag ? { inventory: c.tag } : {}),
    } as Opening);
  }

  // The entrance: a double door in the foyer's front wall.
  const fo = bbox(rooms.foyer!);
  const entrance: Pt = [fo[0] + fo[2] / 2, fo[1] + fo[3]];
  out.push({
    at: [q25(entrance[0]), q25(entrance[1])],
    kind: 'door',
    style: 'door-double',
    width: Math.min(5.4, fo[2] - 2.4),
    inventory: 'Double entrance door of the foyer',
  } as Opening);
  doorSpots.push(entrance);
  swing(out.length - 1, entrance, [1, 0], Math.min(5.4, fo[2] - 2.4), true);

  // Sliding doors from the kitchen and the living room to the outdoor dining, and from the gym to the deck.
  const kit = bbox(rooms.kitchen!);
  const dn = bbox(zones.dining!);
  const kitDoorY = Math.min(kit[1] + kit[3] - 2.4, Math.max(kit[1] + 2.4, dn[1] + dn[3] / 2));
  out.push({
    at: [q25(kit[0] + kit[2]), q25(kitDoorY)],
    kind: 'door',
    style: 'door-sliding',
    swing: 'none',
    width: 5,
    inventory: 'Kitchen door to the outdoor dining',
  } as Opening);
  doorSpots.push([kit[0] + kit[2], kitDoorY]);
  const lv = bbox(rooms.living!);
  out.push({
    at: [q25(lv[0] + lv[2] / 2), q25(lv[1])],
    kind: 'door',
    style: 'door-sliding',
    swing: 'none',
    width: 8,
    inventory: 'Living room opening to the outdoor dining',
  } as Opening);
  doorSpots.push([lv[0] + lv[2] / 2, lv[1]]);
  const gy = bbox(rooms.gym!);
  out.push({
    at: [q25(gy[0]), q25(gy[1] + gy[3] * 0.72)],
    kind: 'door',
    style: 'door-single',
    width: 3.2,
    inventory: 'Gym door to the deck',
  } as Opening);
  doorSpots.push([gy[0], gy[1] + gy[3] * 0.72]);
  swing(out.length - 1, [gy[0], gy[1] + gy[3] * 0.72], [0, 1], 3.2);

  // Windows on free walls of rooms that want daylight.
  for (const [id, shape] of Object.entries(rooms)) {
    if (id === 'terrace') continue;
    const t = ROOMS.find((x) => x.id === id)!;
    if (!WINDOWED.has(t.type)) continue;
    const others = roomPolys.filter(([oid]) => oid !== id).map(([, p]) => p);
    for (const e of freeEdges(polyOf(shape), others, 5)) {
      const mid: Pt = [(e.p[0] + e.q[0]) / 2, (e.p[1] + e.q[1]) / 2];
      if (doorSpots.some((s) => Math.hypot(s[0] - mid[0], s[1] - mid[1]) < 4.5)) continue;
      const small = t.type === 'bathroom' || t.type === 'pantry' || t.type === 'utility';
      out.push({
        at: [q25(mid[0]), q25(mid[1])],
        kind: 'window',
        style:
          t.type === 'living'
            ? 'window-full'
            : t.type === 'gym'
              ? 'window-full'
              : small
                ? 'window-fixed'
                : 'window-casement',
        width: Math.min(small ? 2.5 : t.type === 'living' ? 6 : 4.5, e.len - 1.2),
      } as Opening);
    }
  }
  return { openings: out, swings };
}

function perimeter(
  wall: [number, number, number, number],
  gaps: { side: 'front' | 'back'; x: number; w: number }[],
) {
  const [x0, y0, x1, y1] = wall;
  const walls: NonNullable<Design['walls']> = [];
  const piece = (a: Pt, b: Pt, height = 5) =>
    walls.push({
      from: [q25(a[0]), q25(a[1])],
      to: [q25(b[0]), q25(b[1])],
      type: 'exterior',
      thickness: 0.7,
      height,
      material: 'brick-white',
    } as never);
  const edge = (side: 'front' | 'back', y: number) => {
    const g = gaps.filter((k) => k.side === side).sort((a, b) => a.x - b.x);
    let cur = x0;
    for (const k of g) {
      piece([cur, y], [k.x - k.w / 2 - 0.2, y]);
      cur = k.x + k.w / 2 + 0.2;
    }
    piece([cur, y], [x1, y]);
  };
  // The back wall is a full-height garden wall (it has the garden door); the rest is a low wall with pillars.
  piece([x0, y0], [x1, y0], 7.5);
  edge('front', y1);
  piece([x0, y0], [x0, y1]);
  piece([x1, y0], [x1, y1]);
  return walls;
}

/** Footprint [x0, y0, x1, y1] of an item in feet, and whether it stands on the floor as a solid piece. */
function footprint(it: Item): { box: Swing; solid: boolean } {
  const e = getEntry(it.catalog);
  const d = S(it.catalog);
  const w = it.size ? it.size[0] : d.w;
  const dd = it.size ? it.size[1] : d.d;
  const h = it.size ? it.size[2] : d.h;
  const turned = Math.round(((it.rotation ?? 0) % 180) / 90) % 2 === 1;
  const fw = turned ? dd : w;
  const fd = turned ? w : dd;
  const solid = !!e && e.placement === 'floor' && h > 0.5 && (it.elevation ?? 0) < 0.5;
  return {
    box: [it.at[0] - fw / 2, it.at[1] - fd / 2, it.at[0] + fw / 2, it.at[1] + fd / 2],
    solid,
  };
}
const hit = (a: Swing, b: Swing, pad = 0) =>
  a[0] < b[2] - pad && a[2] > b[0] + pad && a[1] < b[3] - pad && a[3] > b[1] + pad;

/**
 * Doors must open: any floor piece that stands in the way of a door is slid along the room until it is clear (staying
 * in its room and off its neighbours); a piece that cannot be moved is dropped (reported).
 */
function clearDoorSwings(
  items: Item[],
  doorSwings: DoorSwing[],
  openings: Opening[],
  rooms: Record<string, Shape>,
): string[] {
  const notes: string[] = [];
  const live = new Set(doorSwings.map((d) => d.opening));
  const roomOf = (p: Pt): Pt[] | undefined =>
    Object.entries(rooms)
      .filter(([id]) => id !== 'terrace')
      .map(([, sh]) => polyOf(sh))
      .find((poly) => inPoly(p, poly));
  const dropped = new Set<Item>();
  for (const it of items) {
    if (it.level) continue;
    const fp = footprint(it);
    if (!fp.solid || !doorSwings.some((d) => live.has(d.opening) && hit(fp.box, d.zone, 0.25)))
      continue;
    const room = roomOf(it.at);
    if (!room) continue;
    const others = items
      .filter((o) => o !== it && !dropped.has(o))
      .map(footprint)
      .filter((o) => o.solid)
      .map((o) => o.box);
    const attached = items.filter(
      (o) =>
        o !== it &&
        (o.elevation ?? 0) > 0.5 &&
        Math.hypot(o.at[0] - it.at[0], o.at[1] - it.at[1]) < 1.1,
    );
    let moved = false;
    const tries: Pt[] = [];
    for (let k = 1; k <= 40; k++)
      for (const sgn of [1, -1]) tries.push([sgn * k * 0.25, 0], [0, sgn * k * 0.25]);
    tries.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    for (const [dx, dy] of tries) {
      const t: Item = { ...it, at: [it.at[0] + dx, it.at[1] + dy] };
      const b = footprint(t).box;
      const corners: Pt[] = [
        [b[0] + 0.5, b[1] + 0.5],
        [b[2] - 0.5, b[1] + 0.5],
        [b[2] - 0.5, b[3] - 0.5],
        [b[0] + 0.5, b[3] - 0.5],
      ];
      if (!corners.every((c) => inPoly(c, room))) continue;
      if (doorSwings.some((d) => live.has(d.opening) && hit(b, d.zone, 0.25))) continue;
      if (others.some((o) => hit(b, o, 0.05))) continue;
      for (const a of attached) a.at = [a.at[0] + dx, a.at[1] + dy];
      it.at = t.at;
      moved = true;
      break;
    }
    if (!moved) {
      // It cannot be moved: the door becomes a pocket door (no swing) instead.
      for (const d of doorSwings)
        if (live.has(d.opening) && hit(fp.box, d.zone, 0.25)) {
          const o = openings[d.opening]!;
          o.style = 'door-pocket';
          (o as { swing?: string }).swing = 'none';
          live.delete(d.opening);
          notes.push(
            `door at ${o.at.join(', ')} made a pocket door (${it.catalog} stands in its swing)`,
          );
        }
    }
  }
  void dropped;
  return notes;
}

// ───────────────────────────── assembling one option ─────────────────────────────

function buildOption(letter: 'A' | 'B', lay: Layout): Design {
  const design = letter;
  const rooms: Design['rooms'] = [];
  const zones: Design['zones'] = [];
  const f = new Furnisher(design, 10);

  for (const t of ROOMS) {
    if (t.only && t.only !== design) continue;
    const shape = lay.rooms[t.id];
    if (!shape) continue;
    const fixed: Shape = shape.rect
      ? { rect: shape.rect.map(q25) as Rect }
      : { polygon: shape.polygon!.map(([a, b]) => [q25(a), q25(b)] as Pt) };
    rooms.push({
      id: t.id,
      name: t.name,
      type: t.type,
      ...(t.level ? { level: t.level } : {}),
      ...fixed,
      ...(t.floor ? { floor: t.floor } : {}),
      ...(t.wallFinish ? { wallFinish: t.wallFinish } : {}),
      ...(t.label ? { labelSize: t.label } : {}),
      ...(t.id === 'terrace' ? { parapet: true } : {}),
      ...(t.note ? { note: t.note } : {}),
      ...(lay.pic[t.id] ? { pic: lay.pic[t.id] } : {}),
    } as never);
    lay.rooms[t.id] = fixed;
    furnishRoom(f, t.id, fixed, design);
  }
  for (const t of ZONES) {
    if (t.only && t.only !== design) continue;
    const shape = lay.zones[t.id];
    if (!shape) continue;
    const fixed: Shape = shape.rect
      ? { rect: shape.rect.map(q25) as Rect }
      : { polygon: shape.polygon!.map(([a, b]) => [q25(a), q25(b)] as Pt) };
    lay.zones[t.id] = fixed;
    zones.push({
      id: t.id,
      name: t.name,
      type: t.type,
      ...fixed,
      ...(t.material ? { material: t.material } : {}),
      ...(t.covered ? { covered: true } : {}),
      ...(t.label ? { labelSize: t.label } : {}),
      ...(t.note ? { note: t.note } : {}),
      ...(lay.pic[t.id] ? { pic: lay.pic[t.id] } : {}),
    } as never);
    furnishZone(f, t.id, fixed);
  }

  const solids = f.items
    .filter((i) => !i.level)
    .map(footprint)
    .filter((x) => x.solid)
    .map((x) => x.box);
  const { openings, swings } = buildOpenings(lay.rooms, design, lay.zones, solids);
  for (const n of clearDoorSwings(f.items, swings, openings, lay.rooms))
    console.warn(`[${design}] ${n}`);
  {
    const g = bbox(lay.rooms.gym!);
    const gx = q25(g[0] - 2.6);
    openings.push({
      at: [gx, q25(lay.wall[1])],
      kind: 'door',
      style: 'door-single',
      width: 3.4,
      height: 6.6,
      inventory: 'Garden door in the back wall',
    } as Opening);
  }

  // Gates
  const fo = bbox(lay.rooms.foyer!);
  const pedX = q25(fo[0] + fo[2] / 2);
  const park = bbox(lay.zones.parking!);
  const vehX = q25(park[0] + park[2] / 2);
  const [wx0, wy0, wx1, wy1] = lay.wall;
  const gm = bbox(lay.rooms.gym!);
  const gardenDoorX = q25(gm[0] - 2.6);
  const gates: NonNullable<Design['gates']> = [
    {
      kind: 'pedestrian',
      at: [pedX, PLOT_D],
      facing: 'south',
      width: 6,
      inventory: 'Pedestrian gate (main entrance)',
    },
    {
      kind: 'vehicle',
      at: [vehX, PLOT_D],
      facing: 'south',
      width: 16,
      inventory: 'Vehicle gate (car entrance)',
    },
  ];

  // The entrance path runs from the foyer door to the wall: make it reach the gate.
  const ep = zones.find((z) => z.id === 'entrypath');
  if (ep?.rect) {
    ep.rect = [ep.rect[0], ep.rect[1], ep.rect[2], q25(PLOT_D - ep.rect[1])];
  }
  const dw = zones.find((z) => z.id === 'driveway');
  if (dw?.rect) dw.rect = [dw.rect[0], dw.rect[1], dw.rect[2], q25(PLOT_D - dw.rect[1])];

  // Perimeter wall, lit pillars at the corners, the gates and along the wall; hedges inside the wall.
  const walls = perimeter(lay.wall, [
    { side: 'front', x: pedX, w: 6 },
    { side: 'front', x: vehX, w: 16 },
  ]);
  const pillars: Pt[] = [
    [wx0, wy0],
    [wx1, wy0],
    [wx0, wy1],
    [wx1, wy1],
    [pedX - 3.8, wy1],
    [pedX + 3.8, wy1],
    [vehX - 8.6, wy1],
    [vehX + 8.6, wy1],
    [gardenDoorX - 3.1, wy0],
    [gardenDoorX + 3.1, wy0],
  ];
  for (let yy = wy0 + 14; yy < wy1 - 6; yy += 14) pillars.push([wx0, yy], [wx1, yy]);
  for (let xx = wx0 + 14; xx < wx1 - 6; xx += 14)
    if (Math.abs(xx - gardenDoorX) > 5) pillars.push([xx, wy0]);
  for (const [px, py] of pillars)
    f.add('pillar-light', px, py, 0, {
      size: [1.5, 1.5, 4.4],
      ...{ inventory: 'Lit wall pillars' },
    });

  const out = design === 'B';
  const hedgeInset = out ? -1.6 : 1.5;
  const hedgeRuns: [Pt, Pt][] = [
    [
      [wx0 + hedgeInset, wy0 + hedgeInset],
      [wx0 + hedgeInset, wy1 - 1.5],
    ],
    [
      [wx1 - hedgeInset, wy0 + hedgeInset],
      [wx1 - hedgeInset, wy1 - 1.5],
    ],
    [
      [wx0 + hedgeInset, wy0 + hedgeInset],
      [gardenDoorX - 3, wy0 + hedgeInset],
    ],
    [
      [gardenDoorX + 3, wy0 + hedgeInset],
      [wx1 - hedgeInset, wy0 + hedgeInset],
    ],
    [
      [wx0 + hedgeInset, wy1 - 1.5],
      [pedX - 6, wy1 - 1.5],
    ],
    [
      [pedX + 6, wy1 - 1.5],
      [vehX - 10, wy1 - 1.5],
    ],
    [
      [vehX + 10, wy1 - 1.5],
      [wx1 - hedgeInset, wy1 - 1.5],
    ],
  ];
  const lines: NonNullable<Design['lines']> = [];
  for (const [a, b] of hedgeRuns)
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 3)
      lines.push({
        catalog: 'hedge',
        from: [q25(a[0]), q25(a[1])],
        to: [q25(b[0]), q25(b[1])],
        every: 9.8,
        rotation: 'along',
        inventory: 'Perimeter hedges',
      } as never);
  // Palms flanking the entrance and the driveway, in the corners of the back garden and around the front garden.
  const palmSpots: Pt[] = [
    [pedX - 5.2, wy1 - 3.2],
    [pedX + 5.2, wy1 - 3.2],
    [vehX - 10, wy1 - 3.5],
    [out ? wx0 - 3 : wx0 + 5.5, wy1 - 3.5],
    [out ? wx0 - 3 : wx0 + 5.5, wy0 + 4],
    [out ? wx1 + 3 : wx1 - 5, wy0 + 4],
    [out ? wx1 + 3 : wx1 - 5, wy1 - 3.5],
  ];
  for (const [px, py] of palmSpots)
    f.add('tree-palm', px, py, 0, { inventory: 'Palms along the perimeter' });
  if (out)
    for (let xx = wx0 + 6; xx < wx1 - 2; xx += 12)
      if (Math.abs(xx - gardenDoorX) > 7)
        f.add('tree-broad', xx, wy0 - 4.5, 0, { inventory: 'Shade trees' });

  // Side paths between the wall and the wings.
  const sideZones: NonNullable<Design['zones']> = [
    {
      id: 'sideL',
      name: 'Side Path (left)',
      type: 'path',
      rect: [q25(out ? wx0 - 4.2 : wx0 + 2.4), q25(wy0 + 14), 1.5, q25(wy1 - wy0 - 28)],
      material: 'paving-stone',
    } as never,
    {
      id: 'sideR',
      name: 'Side Path (right)',
      type: 'path',
      rect: [q25(out ? wx1 + 2.7 : wx1 - 3.9), q25(wy0 + 14), 1.5, q25(wy1 - wy0 - 28)],
      material: 'paving-stone',
    } as never,
  ];

  // Roofs: everything built on the ground floor except under the roof terrace.
  const terrace = bbox(lay.rooms.terrace!);
  const built = Object.entries(lay.rooms)
    .filter(
      ([id]) =>
        id !== 'terrace' &&
        (!ROOMS.find((r) => r.id === id)?.only || ROOMS.find((r) => r.id === id)?.only === design),
    )
    .map(([, s]) => [polyOf(s).map(([a, b]) => [a, b] as [number, number])] as never);
  const union = polygonClipping.union(built[0]!, ...built.slice(1));
  const hole = [
    [
      [terrace[0], terrace[1]],
      [terrace[0] + terrace[2], terrace[1]],
      [terrace[0] + terrace[2], terrace[1] + terrace[3]],
      [terrace[0], terrace[1] + terrace[3]],
    ],
  ] as never;
  const covered = polygonClipping.difference(union as never, hole);
  const roofs: NonNullable<Design['roofs']> = [];
  for (const poly of covered)
    roofs.push({
      level: 'g',
      kind: 'flat',
      polygon: poly[0]!.slice(0, -1).map(([a, b]) => [q25(a), q25(b)] as Pt),
    } as never);

  // The staircase to the roof terrace, rising north through the stair hall.
  const sh = bbox(lay.stairHall);
  const stairs: NonNullable<Design['stairs']> = [
    {
      id: 'stair-roof',
      from: 'g',
      to: 'roof',
      type: 'straight',
      at: [q25(sh[0] + sh[2] / 2), q25(sh[1] + sh[3] - 0.5)],
      direction: 270,
      width: Math.min(4.5, sh[2] - 1.4),
      railing: true,
      inventory: 'Staircase to the roof terrace',
    } as never,
  ];

  const desc =
    letter === 'A'
      ? 'Every labelled room has exactly its labelled size (to the inch). The arrangement follows the picture; the leftover space becomes corridors and planting.'
      : 'Proportions measured from the straightened picture (it overlays wall for wall at 50 % opacity), scaled so the covered parking is 20 ft wide.';

  return {
    id: letter,
    letter,
    name: letter === 'A' ? 'As labelled' : 'As pictured',
    description: desc,
    rooms,
    walls,
    openings,
    zones: [...zones, ...sideZones],
    gates,
    items: f.items,
    lines: [...f.lines, ...lines],
    stairs,
    roofs,
  } as Design;
}

// ───────────────────────────── the spec ─────────────────────────────

fitCorners();
const A = layoutA();
const B = layoutB();
const designA = buildOption('A', A);
const designB = buildOption('B', B);

/** A point inside both options' room, for the saved views. */
function inside(id: string): Pt {
  const a = bbox(A.rooms[id]!);
  const b = bbox(B.rooms[id]!);
  const x0 = Math.max(a[0], b[0]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y0 = Math.max(a[1], b[1]);
  const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x1 - x0 < 1 || y1 - y0 < 1) {
    const c = bbox(B.rooms[id]!);
    return [c[0] + c[2] / 2, c[1] + c[3] / 2];
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
const livingAt = inside('living');
const bedAt = inside('bed1');
const pool = bbox(B.zones.pool!);
const poolA = bbox(A.zones.pool!);
const poolAt: Pt = [
  (Math.max(pool[0], poolA[0]) + Math.min(pool[0] + pool[2], poolA[0] + poolA[2])) / 2,
  (pool[1] + poolA[1]) / 2 + 9,
];

const cx = PLOT_W / 2;
const spec: ReferenceSpecInput = {
  version: 1,
  name: 'Reference Villa',
  units: 'ft',
  plot: [
    [0, 0],
    [PLOT_W, 0],
    [PLOT_W, PLOT_D],
    [0, PLOT_D],
  ],
  setback: 3,
  levels: [
    { id: 'g', name: 'Ground floor', height: 10 },
    { id: 'roof', name: 'Roof terrace', height: 9 },
  ],
  wallThickness: { exterior: 0.75, interior: 0.4, partition: 0.16 },
  compass: 0,
  lights: { master: 'on', off: [], on: [] },
  views: [
    {
      name: 'Reference top-down',
      mode: 'top',
      position: [q25(B_ORIGIN[0] + CAL.width / 2), 200, q25(B_ORIGIN[1] + CAL.depth / 2)],
      target: [q25(B_ORIGIN[0] + CAL.width / 2), 0, q25(B_ORIGIN[1] + CAL.depth / 2)],
      zoom: 8.5,
    },
    {
      name: 'Front gate',
      mode: 'orbit',
      position: [q25(cx), 6, PLOT_D + 9],
      target: [q25(cx), 4, PLOT_D - 38],
    },
    {
      name: 'Living room',
      mode: 'walk',
      position: [q25(livingAt[0]), 5.4, q25(livingAt[1] + 8)],
      target: [q25(livingAt[0]), 4.6, q25(livingAt[1] - 8)],
    },
    {
      name: 'Pool deck',
      mode: 'orbit',
      position: [q25(poolAt[0] + 10), 11, q25(poolAt[1] + 20)],
      target: [q25(poolAt[0]), 1, q25(poolAt[1] - 6)],
    },
    {
      name: 'Master bedroom',
      mode: 'walk',
      position: [q25(bedAt[0] + 4), 5.4, q25(bedAt[1])],
      target: [q25(bedAt[0] - 6), 3.6, q25(bedAt[1])],
    },
  ],
  underlay: {
    image: IMAGE,
    imageSize: IMAGE_SIZE,
    corners: PIC_CORNERS,
    size: [CAL.width, CAL.depth],
    origin: B_ORIGIN,
    opacity: 0.5,
  },
  designs: [designA, designB],
};

// Every inventory element must be in both options.
{
  const tags = (d: Design) =>
    new Set(
      [
        ...(d.items ?? []).map((i) => i.inventory),
        ...(d.lines ?? []).map((l) => l.inventory),
        ...(d.openings ?? []).map((o) => o.inventory),
        ...(d.gates ?? []).map((g) => g.inventory),
        ...(d.stairs ?? []).map((st) => st.inventory),
      ].filter(Boolean) as string[],
    );
  const ta = tags(designA);
  const tb = tags(designB);
  const onlyA = [...ta].filter((t) => !tb.has(t));
  const onlyB = [...tb].filter((t) => !ta.has(t));
  if (onlyA.length || onlyB.length)
    console.warn(
      `Inventory differs:\n  only in A: ${onlyA.join('; ')}\n  only in B: ${onlyB.join('; ')}`,
    );
  else console.log(`inventory: ${ta.size} elements, the same in both options`);
}

const parsed = parseReferenceSpec(spec);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(spec, null, 1)}\n`);
console.log(
  `wrote ${OUT} (${(JSON.stringify(spec).length / 1024).toFixed(0)} kB, ${parsed.designs.length} designs)`,
);
console.log(
  'fitted corners:',
  JSON.stringify(PIC_CORNERS.map((c) => c.map((v) => Math.round(v * 10) / 10))),
);
console.log(
  `picture scale: ${CAL.width} × ${CAL.depth} ft; parking ${bbox(B.zones.parking!)[2].toFixed(2)} ft wide`,
);
if (B.snapReport.length) console.log(`Option B notes:\n  ${B.snapReport.join('\n  ')}`);
