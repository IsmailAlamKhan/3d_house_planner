import { type Vec2, dist } from '../../geometry/vec';
import type { Point, RoomType } from '../../model/types';
import type { Rect } from './plan';
import { rectArea, rectCenter } from './plan';
import type { Emphasis } from './weights';
import { aspect, exteriorEdges, rng, shuffled, sharedEdge, squarify } from './rect';

/** A room as the layout search sees it. */
export interface RoomSpec {
  name: string;
  type: RoomType;
  /** Area weight after scaling to the shell (m²). */
  area: number;
  minWidth: number;
  /** Names of rooms on this level it must be next to, with the kind of connection. */
  adjacency: { room: string; connection: 'door' | 'open' }[];
  exteriorWall: 'required' | 'preferred' | 'none';
  needsWindow: boolean;
  wet: boolean;
  /** Name of a room on the level below this one should sit above. */
  above?: string;
  /** The room's rectangle is decided up front (a double-height space takes a whole region). */
  fixed?: Rect;
  doubleHeight?: boolean;
}

export interface LevelContext {
  shell: Rect;
  /** The hall / landing that holds the stair. */
  hall: Rect;
  /** Free regions to fill with rooms (together with `hall` they tile the shell). */
  regions: Rect[];
  plumbing: Point[];
  /** Centres of wet rooms on the level below (for stacking upstairs bathrooms). */
  wetBelow: Point[];
  /** Rectangles of those wet rooms (the optimiser stacks onto them). */
  wetBelowRects?: Rect[];
  /** Positions of rooms on the level below by name (for `above`). */
  roomsBelow: Map<string, Rect>;
  /** — used by the optimiser (all optional) — */
  level?: number;
  /** Where the main entrance is (plan metres). */
  entrance?: Point;
  /** Floor area of the level (m²), open courts excluded. */
  levelArea?: number;
  /** Area already spent on circulation by the skeleton (the stair hall), m². */
  circulationArea?: number;
  /** Open-air rectangles inside the shell (courtyards): their walls give daylight. */
  outdoors?: Rect[];
  /** Which plan side the garden is on (villas): the living room wants a view there. */
  gardenSide?: 'N' | 'S' | 'E' | 'W';
  /** Optional orientation preferences (off by default). */
  orientation?: Orientation;
  /** What the person asked to improve (multipliers on score terms). */
  emphasis?: Emphasis;
  /** Where rooms should be (plan metres) by lower-case name; `w` scales how much it matters (locked rooms use more). */
  hints?: Record<string, { x: number; y: number; w?: number }>;
}

export interface Orientation {
  /** Side that gets the sun: bedrooms and living rooms like an outside wall there. */
  sunny?: 'N' | 'S' | 'E' | 'W';
  /** A rule set of traditional placement preferences. */
  rules?: 'vastu';
}

/** What a level's arrangement achieved, term by term (the raw material of the plain-language explanation). */
export interface LevelFacts {
  adjacency: { a: string; b: string; ok: boolean }[];
  daylight: { room: string; type: RoomType; outside: number; need: number }[];
  circulation: number;
  thin: { room: string; ratio: number }[];
  throughBedroom: string[];
  stacked: { room: string; ok: boolean }[];
  wetGrouped: boolean | null;
  views: { room: string; ok: boolean }[];
  partitionLines: number;
}

export interface LevelResult {
  rects: Map<string, Rect>;
  score: number;
  /** Penalty breakdown, for the warnings. */
  unmetAdjacency: [string, string][];
  narrow: { name: string; width: number; wanted: number }[];
  noWindow: string[];
  unreachable: string[];
  /** Optimiser only: penalty per term and the facts behind them. */
  terms?: Record<string, number>;
  facts?: LevelFacts;
}

/** Length of shared wall needed for a door between two rooms. */
export const MIN_DOOR_WALL = 1.1;

const key = (s: string) => s.trim().toLowerCase();

/** Orders rooms so that rooms asking to be adjacent are neighbours in the sequence (a greedy chain). */
export function adjacencyOrder(rooms: RoomSpec[]): RoomSpec[] {
  const degree = (r: RoomSpec) =>
    r.adjacency.length +
    rooms.filter((o) => o.adjacency.some((a) => key(a.room) === key(r.name))).length;
  const left = rooms.slice().sort((a, b) => degree(b) - degree(a) || b.area - a.area);
  const out: RoomSpec[] = [];
  while (left.length) {
    const last = out[out.length - 1];
    let next: RoomSpec | undefined;
    if (last) {
      const wanted = new Set([
        ...last.adjacency.map((a) => key(a.room)),
        ...rooms
          .filter((o) => o.adjacency.some((a) => key(a.room) === key(last.name)))
          .map((o) => key(o.name)),
      ]);
      next = left.find((r) => wanted.has(key(r.name)));
    }
    next ??= left[0]!;
    left.splice(left.indexOf(next), 1);
    out.push(next);
  }
  return out;
}

/** Splits an ordered room list between regions so each region receives roughly its share of the area. */
export function partition(rooms: RoomSpec[], regions: Rect[]): RoomSpec[][] {
  const total = rooms.reduce((s, r) => s + r.area, 0);
  const cap = regions.reduce((s, r) => s + rectArea(r), 0);
  const groups: RoomSpec[][] = regions.map(() => []);
  let ri = 0;
  let acc = 0;
  rooms.forEach((room, idx) => {
    const share = (rectArea(regions[ri]!) / cap) * total;
    const regionsLeft = regions.length - 1 - ri;
    const roomsLeft = rooms.length - idx;
    // Move on when this region is "full enough" — and always keep one room back for every region still waiting.
    const full = acc + room.area / 2 > share;
    if (regionsLeft > 0 && groups[ri]!.length > 0 && (full || roomsLeft <= regionsLeft)) {
      ri++;
      acc = 0;
    }
    groups[ri]!.push(room);
    acc += room.area;
  });
  return groups;
}

export function centroid(r: Rect): Vec2 {
  return rectCenter(r);
}

const SHARED_FOR_REACH = 0.9;

/** Scores one arrangement; lower is better. */
function evaluate(rooms: RoomSpec[], rects: Map<string, Rect>, ctx: LevelContext): LevelResult {
  let score = 0;
  const unmetAdjacency: [string, string][] = [];
  const narrow: LevelResult['narrow'] = [];
  const noWindow: string[] = [];
  const names = new Map(rooms.map((r) => [key(r.name), r]));

  for (const room of rooms) {
    const rect = rects.get(room.name)!;
    const short = Math.min(rect.w, rect.h);
    if (short < room.minWidth - 1e-6) {
      score += 50 + 25 * (room.minWidth - short);
      narrow.push({ name: room.name, width: short, wanted: room.minWidth });
    }
    const ar = aspect(rect);
    if (ar > 2.6) score += 7 * (ar - 2.6);
    // A room far from the area it asked for is a (soft) problem too.
    score += Math.abs(rectArea(rect) - room.area) * 0.15;

    const ext = exteriorEdges(rect, ctx.shell).reduce((m, e) => Math.max(m, e.length), 0);
    if (room.exteriorWall === 'required' && ext < 1.3) {
      score += 35;
      noWindow.push(room.name);
    } else if (room.needsWindow && ext < 1.3) {
      score += room.exteriorWall === 'preferred' ? 9 : 3;
      noWindow.push(room.name);
    }
    if (room.wet && ctx.plumbing.length) {
      const c = centroid(rect);
      score += 1.1 * Math.min(...ctx.plumbing.map((p) => dist(p, c)));
    }
    if (room.wet && room.type === 'bathroom' && ctx.wetBelow.length) {
      const c = centroid(rect);
      score += 1.6 * Math.min(...ctx.wetBelow.map((p) => dist(p, c)));
    }
    if (room.above) {
      const below = ctx.roomsBelow.get(key(room.above));
      if (below) score += 2 * dist(centroid(below), centroid(rect));
    }
    for (const adj of room.adjacency) {
      const other = names.get(key(adj.room));
      if (!other) continue;
      const edge = sharedEdge(rect, rects.get(other.name)!);
      if (!edge || edge.length < MIN_DOOR_WALL) {
        // Count each pair once.
        if (
          !unmetAdjacency.some(
            ([a, b]) =>
              (a === room.name && b === other.name) || (a === other.name && b === room.name),
          )
        ) {
          unmetAdjacency.push([room.name, other.name]);
          score += 40;
        }
      }
    }
  }

  // Every room must be reachable from the hall through walls long enough for a door.
  const all = [...rects.entries()];
  const reached = new Set<string>();
  const queue: Rect[] = [ctx.hall];
  const seen = new Set<Rect>([ctx.hall]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [name, r] of all) {
      if (seen.has(r)) continue;
      const e = sharedEdge(cur, r);
      if (e && e.length >= SHARED_FOR_REACH) {
        seen.add(r);
        reached.add(name);
        queue.push(r);
      }
    }
  }
  const unreachable = rooms.filter((r) => !reached.has(r.name)).map((r) => r.name);
  score += unreachable.length * 100;
  return { rects, score, unmetAdjacency, narrow, noWindow, unreachable };
}

/**
 * Tries many room orderings (the adjacency-aware chain first, then seeded shuffles), tiles each region with a
 * squarified treemap and keeps the arrangement with the lowest score.
 */
export function layoutLevel(
  rooms: RoomSpec[],
  ctx: LevelContext,
  seed: number,
  tries: number,
): LevelResult {
  const rnd = rng(seed);
  // Rooms with a fixed rectangle are not tiled — they only take part in scoring.
  const free = rooms.filter((r) => !r.fixed);
  const fixed = rooms.filter((r) => r.fixed);
  const chain = adjacencyOrder(free);
  const orders: RoomSpec[][] = [chain, chain.slice().reverse()];
  for (let i = 0; i < tries; i++) {
    // Half the shuffles keep rooms sorted by size (squarified works best that way), half are fully random.
    const base = shuffled(free, rnd);
    orders.push(i % 2 === 0 ? base : base.sort((a, b) => b.area - a.area + (rnd() - 0.5) * 4));
  }
  let best: LevelResult | null = null;
  for (const order of orders) {
    const rects = new Map<string, Rect>();
    for (const f of fixed) rects.set(f.name, f.fixed!);
    if (order.length) {
      const groups = partition(order, ctx.regions);
      groups.forEach((group, gi) => {
        if (!group.length) return;
        const placed = squarify(
          group.map((r) => r.area),
          ctx.regions[gi]!,
        );
        group.forEach((room, i) => rects.set(room.name, placed[i]!));
      });
    }
    if (rects.size !== rooms.length) continue;
    const result = evaluate(rooms, rects, ctx);
    if (!best || result.score < best.score) best = result;
  }
  // `best` is always set: the first order always produces a full tiling.
  return best!;
}
