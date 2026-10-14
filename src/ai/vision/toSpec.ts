import {
  bbox,
  freeEdges,
  polyOf,
  rectPoly,
  sharedSegment,
  type Pt,
  type Rect,
} from '../../reference/wallGeometry';
import type { ReferenceSpecInput } from '../../reference/spec';
import type { PlanRect } from './cleanup';
import { slug } from './labels';

type Design = ReferenceSpecInput['designs'][number];
type Opening = NonNullable<Design['openings']>[number];

const MARGIN = 8; // feet of plot around the drawn plan
const WINDOWED = new Set([
  'bedroom',
  'kitchen',
  'living',
  'gym',
  'dining',
  'study',
  'bathroom',
  'utility',
]);
const SMALL = new Set(['bathroom', 'walk-in-closet', 'pantry', 'utility', 'sauna', 'spa']);
const q = (v: number) => Math.round(v * 4) / 4;

export interface SpecInput {
  /** The rooms and areas for each design option, already fitted. Keys are the option letters. */
  options: {
    letter: string;
    name: string;
    description: string;
    rects: PlanRect[];
    /** Furniture found in the picture, in the same feet as the rectangles. */
    items?: { catalog: string; at: [number, number]; rotation?: number }[];
  }[];
  name?: string;
}

/** A unique, readable id per rectangle. */
function ids(rects: PlanRect[]): Map<PlanRect, string> {
  const taken = new Set<string>();
  const out = new Map<PlanRect, string>();
  for (const r of rects) {
    const base = slug(r.name);
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    out.set(r, id);
  }
  return out;
}

/**
 * Rooms and areas → a reference spec the exact builder understands: a plot around everything, a door between rooms
 * that share a wall (a spanning tree from the foyer, so every room is reachable), the entrance, windows on outside
 * walls, a gate and path at the front, and flat roofs. All of it is plain, editable spec.
 */
/** Where the plot starts, in the feet of the rectangles: the spec's (0, 0) is this point. */
export function specOrigin(input: SpecInput): [number, number] {
  const all = input.options.flatMap((o) => o.rects);
  return [
    q(Math.min(...all.map((r) => r.rect[0])) - MARGIN),
    q(Math.min(...all.map((r) => r.rect[1])) - MARGIN),
  ];
}

export function toSpec(input: SpecInput): ReferenceSpecInput {
  const all = input.options.flatMap((o) => o.rects);
  if (!all.length) throw new Error('There are no rooms to build.');
  const minX = Math.min(...all.map((r) => r.rect[0]));
  const minY = Math.min(...all.map((r) => r.rect[1]));
  const maxX = Math.max(...all.map((r) => r.rect[0] + r.rect[2]));
  const maxY = Math.max(...all.map((r) => r.rect[1] + r.rect[3]));
  const ox = q(minX - MARGIN);
  const oy = q(minY - MARGIN);
  const plotW = q(maxX - ox + MARGIN);
  const plotD = q(maxY - oy + MARGIN);
  const move = (r: Rect): Rect => [q(r[0] - ox), q(r[1] - oy), r[2], r[3]];

  const designs = input.options.map((o) => designOf(o, move, plotD));
  return {
    version: 1,
    name: input.name ?? 'Recreated from picture',
    units: 'ft',
    plot: [
      [0, 0],
      [plotW, 0],
      [plotW, plotD],
      [0, plotD],
    ],
    setback: 2,
    levels: [{ id: 'g', name: 'Ground floor', height: 10 }],
    wallThickness: { exterior: 0.75, interior: 0.4, partition: 0.16 },
    lights: { master: 'auto', off: [], on: [] },
    views: [
      {
        name: 'Top',
        mode: 'top',
        position: [plotW / 2, 200, plotD / 2],
        target: [plotW / 2, 0, plotD / 2],
        zoom: 12,
      },
    ],
    designs,
  } as ReferenceSpecInput;
}

function designOf(o: SpecInput['options'][number], move: (r: Rect) => Rect, plotD: number): Design {
  const id = ids(o.rects);
  const rooms = o.rects.filter((r) => r.kind === 'room');
  const zones = o.rects.filter((r) => r.kind === 'zone');
  const geo = new Map(rooms.map((r) => [r, move(r.rect)] as const));
  const poly = (r: PlanRect): Pt[] => polyOf({ rect: geo.get(r)! });
  const openings: Opening[] = [];

  // Doors: a spanning tree over the rooms that share a wall, from the foyer (else the living room, else the largest).
  const typeRank = (r: PlanRect) => (r.type === 'foyer' ? 0 : r.type === 'living' ? 1 : 2);
  const root = [...rooms].sort(
    (a, b) => typeRank(a) - typeRank(b) || b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3],
  )[0];
  const seen = new Set<PlanRect>();
  const doorSpots: Pt[] = [];
  if (root) {
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const a = queue.shift()!;
      // the best neighbours first: longest shared wall
      const nb = rooms
        .filter((b) => !seen.has(b))
        .map((b) => ({ b, s: sharedSegment(poly(a), poly(b), 2.6) }))
        .filter((x) => x.s)
        .sort((x, y) => y.s!.len - x.s!.len);
      for (const { b, s } of nb) {
        if (seen.has(b)) continue;
        seen.add(b);
        queue.push(b);
        const small = SMALL.has(a.type) || SMALL.has(b.type);
        const width = Math.min(small ? 2.5 : 3, s!.len - 0.8);
        const at: Pt = [(s!.p[0] + s!.q[0]) / 2, (s!.p[1] + s!.q[1]) / 2];
        doorSpots.push(at);
        openings.push({
          at: [q(at[0]), q(at[1])],
          kind: a.type === 'foyer' || b.type === 'foyer' ? 'archway' : 'door',
          style:
            a.type === 'foyer' || b.type === 'foyer'
              ? 'archway'
              : small
                ? 'door-pocket'
                : 'door-single',
          width: a.type === 'foyer' || b.type === 'foyer' ? Math.min(5, s!.len - 0.8) : width,
          ...(small ? { swing: 'none' } : {}),
        } as Opening);
      }
    }
  }

  // The entrance: a double door on the foyer's (else the root's) free wall nearest the front.
  const front = root ? root : undefined;
  let entrance: Pt | undefined;
  if (front) {
    const others = rooms.filter((r) => r !== front).map(poly);
    const free = freeEdges(poly(front), others, 4);
    const nearest = free.sort((a, b) => Math.max(b.p[1], b.q[1]) - Math.max(a.p[1], a.q[1]))[0];
    if (nearest) {
      entrance = [(nearest.p[0] + nearest.q[0]) / 2, (nearest.p[1] + nearest.q[1]) / 2];
      doorSpots.push(entrance);
      openings.push({
        at: [q(entrance[0]), q(entrance[1])],
        kind: 'door',
        style: 'door-double',
        width: Math.min(5, nearest.len - 1),
      } as Opening);
    }
  }

  // Windows on free walls of rooms that want daylight.
  for (const r of rooms) {
    if (!WINDOWED.has(r.type)) continue;
    const others = rooms.filter((x) => x !== r).map(poly);
    for (const e of freeEdges(poly(r), others, 5)) {
      const mid: Pt = [(e.p[0] + e.q[0]) / 2, (e.p[1] + e.q[1]) / 2];
      if (doorSpots.some((s) => Math.hypot(s[0] - mid[0], s[1] - mid[1]) < 4.5)) continue;
      const small = SMALL.has(r.type);
      openings.push({
        at: [q(mid[0]), q(mid[1])],
        kind: 'window',
        style: small ? 'window-fixed' : 'window-casement',
        width: Math.min(small ? 2.5 : 4.5, e.len - 1.2),
      } as Opening);
    }
  }

  // Gates: a pedestrian gate and path at the front in line with the entrance; a vehicle gate by parking.
  const gates: NonNullable<Design['gates']> = [];
  const zoneSpecs: NonNullable<Design['zones']> = zones.map((z) => ({
    id: id.get(z)!,
    name: z.name,
    type: z.type,
    rect: move(z.rect),
    ...(z.type === 'parking' ? { covered: true } : {}),
    ...(z.labelSize ? { labelSize: z.labelSize } : {}),
  })) as NonNullable<Design['zones']>;
  if (entrance) {
    const x = q(entrance[0]);
    gates.push({ kind: 'pedestrian', at: [x, plotD], facing: 'south', width: 5 });
    if (
      !zoneSpecs.some(
        (z) => z.type === 'path' && z.rect && z.rect[0] <= x && x <= z.rect[0] + z.rect[2],
      )
    )
      zoneSpecs.push({
        id: 'entrance-path',
        name: 'Entrance path',
        type: 'path',
        rect: [q(x - 3), q(entrance[1]), 6, q(plotD - entrance[1])],
        material: 'paving-stone',
      } as NonNullable<Design['zones']>[number]);
  }
  const parking = zoneSpecs.find((z) => z.type === 'parking' && z.rect);
  if (parking?.rect) {
    gates.push({
      kind: 'vehicle',
      at: [q(parking.rect[0] + parking.rect[2] / 2), plotD],
      facing: 'south',
      width: Math.min(14, parking.rect[2] - 1),
    });
    // a driveway from the parking to the gate
    zoneSpecs.push({
      id: 'driveway',
      name: 'Driveway',
      type: 'path',
      rect: [
        parking.rect[0],
        q(parking.rect[1] + parking.rect[3]),
        parking.rect[2],
        q(plotD - parking.rect[1] - parking.rect[3]),
      ],
      material: 'gravel',
    } as NonNullable<Design['zones']>[number]);
  }

  return {
    id: o.letter,
    letter: o.letter,
    name: o.name,
    description: o.description,
    rooms: rooms.map((r) => ({
      id: id.get(r)!,
      name: r.name,
      type: r.type as never,
      rect: geo.get(r)!,
      ...(r.labelSize ? { labelSize: r.labelSize } : {}),
    })),
    openings,
    zones: zoneSpecs,
    gates,
    roofs: rooms.map((r) => ({ level: 'g', kind: 'flat', polygon: rectPoly(geo.get(r)!) })),
    walls: [],
    items: (o.items ?? []).map((it) => {
      const off = move([0, 0, 0, 0]);
      return {
        catalog: it.catalog,
        at: [q(it.at[0] + off[0]), q(it.at[1] + off[1])] as [number, number],
        rotation: it.rotation ?? 0,
        props: {},
      };
    }),
    lines: [],
    stairs: [],
  } as Design;
}

export { bbox };
