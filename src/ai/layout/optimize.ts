import { DEFAULT_MIN_AREAS } from '../../checks/types';
import { dist } from '../../geometry/vec';
import type { RoomType } from '../../model/types';
import type { Rect } from './plan';
import { rectArea, rectCenter } from './plan';
import { aspect, exteriorEdges, rng, sharedEdge } from './rect';
import {
  type LevelContext,
  type LevelFacts,
  type LevelResult,
  type RoomSpec,
  adjacencyOrder,
  partition,
} from './levelLayout';
import {
  AR_LIMIT,
  AR_LIMIT_SERVICE,
  CORRIDOR_TARGET,
  DOOR_WALL,
  type Weights,
  weightsFor,
  WALK_WALL,
  WALL_PER_M2,
} from './weights';

/**
 * Constraint-based layout optimiser: pure TypeScript, deterministic for a seed.
 *
 * A level's free regions (what is left of the shell after the skeleton's stair hall / corridors / courts) are cut into
 * rooms by **slicing trees**: every inner node cuts its rectangle in two, vertically or horizontally, at a position set
 * by the room areas below it and a bias. A slicing tree always tiles its region exactly, so rooms never overlap and
 * never leave the building: those two hard constraints hold by construction. Simulated annealing then improves the
 * score with these moves: swap two rooms, move a room next to another (possibly in another region), flip a cut, mirror
 * a subtree, rotate a subtree (changes which rooms share walls) and resize (the bias).
 *
 * The score (see weights.ts) mixes the other hard constraints (reachability, minimum width / area) with the quality
 * terms: area match, aspect ratio, adjacency wishes, zoning, daylight, corridor share, plumbing, views, straight walls.
 */

type Node = Leaf | Split;
interface Leaf {
  k: 'leaf';
  i: number;
}
interface Split {
  k: 'split';
  /** `v` = a vertical cut (children side by side), `h` = a horizontal cut (children stacked). */
  dir: 'v' | 'h';
  bias: number;
  a: Node;
  b: Node;
}

const clone = (n: Node): Node =>
  n.k === 'leaf' ? { k: 'leaf', i: n.i } : { ...n, a: clone(n.a), b: clone(n.b) };

const key = (s: string) => s.trim().toLowerCase();

/** Room types a person walks through on the way to another room (the rest are dead ends). */
const PASSABLE = new Set<RoomType>([
  'corridor',
  'stair',
  'foyer',
  'living',
  'dining',
  'kitchen',
  'study',
  'other',
  'outdoor',
  'balcony',
  'game-room',
  'home-theatre',
]);
/** Rooms that may open off a private room (en-suite style). */
const ATTACHED = new Set<RoomType>([
  'bathroom',
  'walk-in-closet',
  'sauna',
  'spa',
  'laundry',
  'pantry',
  'utility',
]);
/** Rooms the front door may open into. */
const ENTRANCE_OK = new Set<RoomType>(['stair', 'foyer', 'corridor', 'living', 'dining', 'other']);
const SERVICE = new Set<RoomType>([
  'bathroom',
  'utility',
  'laundry',
  'walk-in-closet',
  'pantry',
  'sauna',
  'spa',
]);
const CIRCULATION = new Set<RoomType>(['corridor', 'stair', 'foyer']);
const HABITABLE = new Set<RoomType>(['living', 'dining', 'kitchen', 'bedroom', 'study']);

interface Prepared {
  specs: RoomSpec[];
  keys: string[];
  /** Index of each room by lower-case name. */
  byName: Map<string, number>;
  n: number;
  ctx: LevelContext;
  /** Rooms whose rectangle comes from the skeleton. */
  fixed: (Rect | undefined)[];
  free: number[];
  levelArea: number;
  W: Weights;
}

function prepare(specs: RoomSpec[], ctx: LevelContext): Prepared {
  const byName = new Map(specs.map((s, i) => [key(s.name), i]));
  const levelArea = ctx.levelArea ?? ctx.shell.w * ctx.shell.h;
  return {
    specs,
    keys: specs.map((s) => key(s.name)),
    byName,
    n: specs.length,
    ctx,
    fixed: specs.map((s) => s.fixed),
    free: specs.map((s, i) => (s.fixed ? -1 : i)).filter((i) => i >= 0),
    levelArea,
    W: weightsFor(ctx.emphasis),
  };
}

// ─────────────────────────── slicing trees ───────────────────────────

function build(node: Node, rect: Rect, areas: number[], out: Rect[]): number {
  if (node.k === 'leaf') {
    out[node.i] = rect;
    return areas[node.i]!;
  }
  // Measure the children first (their summed area decides the cut), then place them.
  const sa = weight(node.a, areas);
  const sb = weight(node.b, areas);
  const frac = Math.min(0.88, Math.max(0.12, (sa * node.bias) / (sa * node.bias + sb)));
  if (node.dir === 'v') {
    const w = rect.w * frac;
    build(node.a, { x: rect.x, y: rect.y, w, h: rect.h }, areas, out);
    build(node.b, { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h }, areas, out);
  } else {
    const h = rect.h * frac;
    build(node.a, { x: rect.x, y: rect.y, w: rect.w, h }, areas, out);
    build(node.b, { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h }, areas, out);
  }
  return sa + sb;
}

function weight(node: Node, areas: number[]): number {
  return node.k === 'leaf' ? areas[node.i]! : weight(node.a, areas) + weight(node.b, areas);
}

/** A balanced tree over `order` (already adjacency-ordered): the cut follows the longer side of the rectangle. */
function balanced(order: number[], rect: Rect, areas: number[]): Node {
  if (order.length === 1) return { k: 'leaf', i: order[0]! };
  const total = order.reduce((s, i) => s + areas[i]!, 0);
  let acc = 0;
  let cut = 1;
  for (let j = 0; j < order.length - 1; j++) {
    acc += areas[order[j]!]!;
    cut = j + 1;
    if (acc >= total / 2) break;
  }
  const left = order.slice(0, cut);
  const right = order.slice(cut);
  const sa = left.reduce((s, i) => s + areas[i]!, 0);
  const frac = sa / total;
  const dir: 'v' | 'h' = rect.w >= rect.h ? 'v' : 'h';
  const [ra, rb] =
    dir === 'v'
      ? [
          { ...rect, w: rect.w * frac },
          { ...rect, x: rect.x + rect.w * frac, w: rect.w * (1 - frac) },
        ]
      : [
          { ...rect, h: rect.h * frac },
          { ...rect, y: rect.y + rect.h * frac, h: rect.h * (1 - frac) },
        ];
  return { k: 'split', dir, bias: 1, a: balanced(left, ra, areas), b: balanced(right, rb, areas) };
}

function leavesOf(node: Node, out: Leaf[] = []): Leaf[] {
  if (node.k === 'leaf') out.push(node);
  else {
    leavesOf(node.a, out);
    leavesOf(node.b, out);
  }
  return out;
}
function splitsOf(node: Node, out: Split[] = []): Split[] {
  if (node.k === 'split') {
    out.push(node);
    splitsOf(node.a, out);
    splitsOf(node.b, out);
  }
  return out;
}

/** Removes the leaf for room `i` from a tree (returns the tree without it, or null if it was the only leaf). */
function without(node: Node, i: number): Node | null {
  if (node.k === 'leaf') return node.i === i ? null : node;
  const a = without(node.a, i);
  const b = without(node.b, i);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}
/** Replaces leaf `target` by a split holding it and the room `i`. */
function insertNextTo(node: Node, target: number, i: number, dir: 'v' | 'h', first: boolean): Node {
  if (node.k === 'leaf') {
    if (node.i !== target) return node;
    const mine: Leaf = { k: 'leaf', i };
    return { k: 'split', dir, bias: 1, a: first ? mine : node, b: first ? node : mine };
  }
  return {
    ...node,
    a: insertNextTo(node.a, target, i, dir, first),
    b: insertNextTo(node.b, target, i, dir, first),
  };
}

// ─────────────────────────── scoring ───────────────────────────

interface Scored {
  score: number;
  terms: Record<string, number>;
  facts: LevelFacts;
  unreachable: string[];
  noWindow: string[];
  narrow: LevelResult['narrow'];
  unmetAdjacency: [string, string][];
}

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const orient = (dir: 'N' | 'S' | 'E' | 'W', r: Rect, shell: Rect): number => {
  // Length of the room's edge lying on the given side of the shell.
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-4;
  if (dir === 'N') return near(r.y, shell.y) ? r.w : 0;
  if (dir === 'S') return near(r.y + r.h, shell.y + shell.h) ? r.w : 0;
  if (dir === 'W') return near(r.x, shell.x) ? r.h : 0;
  return near(r.x + r.w, shell.x + shell.w) ? r.h : 0;
};

/** Longest stretch of a room's boundary that gives daylight: the shell's outline or an open court. */
export function outsideLength(r: Rect, shell: Rect, outdoors: Rect[] | undefined): number {
  let best = 0;
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-4;
  if (near(r.y, shell.y) || near(r.y + r.h, shell.y + shell.h)) best = Math.max(best, r.w);
  if (near(r.x, shell.x) || near(r.x + r.w, shell.x + shell.w)) best = Math.max(best, r.h);
  for (const o of outdoors ?? []) {
    const e = sharedEdge(r, o);
    if (e) best = Math.max(best, e.length);
  }
  return best;
}

function score(p: Prepared, rects: Rect[], full: boolean): Scored {
  const { specs, ctx, n, W } = p;
  const terms: Record<string, number> = {};
  const add = (name: string, v: number) => {
    if (v) terms[name] = (terms[name] ?? 0) + v;
  };
  const facts: LevelFacts = {
    adjacency: [],
    daylight: [],
    circulation: 0,
    thin: [],
    throughBedroom: [],
    stacked: [],
    wetGrouped: null,
    views: [],
    partitionLines: 0,
  };
  const narrow: LevelResult['narrow'] = [];
  const noWindow: string[] = [];
  const unmet: [string, string][] = [];

  // Shared wall length between every pair (the hall counts as an extra node at index n).
  const hasHall = ctx.hall.w > 1e-6 && ctx.hall.h > 1e-6;
  const nodes = hasHall ? [...rects, ctx.hall] : rects;
  const m = nodes.length;
  const wall: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      const e = sharedEdge(nodes[i]!, nodes[j]!);
      if (e) wall[i]![j] = wall[j]![i] = e.length;
    }

  for (let i = 0; i < n; i++) {
    const s = specs[i]!;
    const r = rects[i]!;
    const area = rectArea(r);
    const short = Math.min(r.w, r.h);
    const exempt = s.type === 'corridor' || s.type === 'stair' || s.type === 'outdoor';
    if (short < s.minWidth - 1e-6) {
      add('narrow', W.narrowBase + W.narrowPerMetre * (s.minWidth - short));
      narrow.push({ name: s.name, width: short, wanted: s.minWidth });
    }
    const minArea = DEFAULT_MIN_AREAS[s.type];
    if (minArea && area < minArea * 0.97 && !s.fixed)
      add('minArea', W.minAreaBase + W.minAreaPerM2 * (minArea - area));
    if (!exempt) {
      const limit = SERVICE.has(s.type) ? AR_LIMIT_SERVICE : AR_LIMIT;
      const ar = aspect(r);
      if (ar > limit) {
        add('aspect', Math.min(4, ar - limit) * W.aspect);
        if (full) facts.thin.push({ room: s.name, ratio: ar });
      }
      if (!s.fixed)
        add('area', Math.min(6, Math.abs(area - s.area) / Math.max(4, s.area)) * W.area);
    }

    // Daylight: an outside wall (or an open court) at least as long as the rule asks.
    const out = outsideLength(r, ctx.shell, ctx.outdoors);
    const need = Math.max(
      1.3,
      area * WALL_PER_M2 * (s.type === 'bedroom' || s.type === 'living' ? 1.4 : 1),
    );
    if (out < 1.3) {
      if (s.exteriorWall === 'required') {
        add('noWindow', W.noWindowRequired);
        noWindow.push(s.name);
      } else if (s.needsWindow) {
        add(
          'noWindow',
          HABITABLE.has(s.type)
            ? W.noWindowHabitable
            : s.exteriorWall === 'preferred'
              ? W.noWindowPreferred
              : W.noWindowNice,
        );
        noWindow.push(s.name);
      }
    } else if (HABITABLE.has(s.type) && out < need) {
      add('daylight', W.daylightShortfall * ((need - out) / need));
    }
    if (full && (HABITABLE.has(s.type) || s.needsWindow))
      facts.daylight.push({ room: s.name, type: s.type, outside: out, need });

    // Wet rooms near the plumbing points and above the wet rooms below.
    if (s.wet && ctx.plumbing.length) {
      const c = rectCenter(r);
      add('plumbing', W.plumbing * Math.min(...ctx.plumbing.map((q) => dist(q, c))));
    }
    if (s.wet && s.type === 'bathroom' && ctx.wetBelow.length) {
      const c = rectCenter(r);
      const d = Math.min(...ctx.wetBelow.map((q) => dist(q, c)));
      const f = Math.max(
        0,
        ...(ctx.wetBelowRects ?? []).map(
          (b) => overlapArea(r, b) / Math.max(0.1, Math.min(rectArea(r), rectArea(b))),
        ),
      );
      const ok = f >= 0.45;
      if (!ok) add('stacking', W.stackingMiss + W.stacking * d * 0.5);
      if (full) facts.stacked.push({ room: s.name, ok });
    }
    if (s.above) {
      const below = ctx.roomsBelow.get(key(s.above));
      if (below) add('stacking', 2 * dist(rectCenter(below), rectCenter(r)));
    }

    // Adjacency wishes.
    for (const adj of s.adjacency) {
      const j = p.byName.get(key(adj.room));
      if (j === undefined) continue;
      const len = wall[i]![j]!;
      const ok = len >= DOOR_WALL;
      const pair: [string, string] = [s.name, specs[j]!.name];
      if (
        full &&
        !facts.adjacency.some(
          (f) => (f.a === pair[0] && f.b === pair[1]) || (f.a === pair[1] && f.b === pair[0]),
        )
      )
        facts.adjacency.push({ a: pair[0], b: pair[1], ok });
      if (!ok) {
        if (
          !unmet.some(
            ([a, b]) => (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]),
          )
        ) {
          unmet.push(pair);
          const ensuite =
            (s.type === 'bedroom' && specs[j]!.type === 'bathroom') ||
            (s.type === 'bathroom' && specs[j]!.type === 'bedroom');
          add('adjacency', ensuite ? W.ensuiteMiss : W.adjacencyMiss);
        }
      } else if (adj.connection === 'open' && len < 1.9) add('adjacency', W.adjacencyShortOpen);
    }
  }

  // Wet rooms share walls with each other (pipes run together).
  const wets = specs.map((s, i) => (s.wet && SERVICE.has(s.type) ? i : -1)).filter((i) => i >= 0);
  if (wets.length > 1) {
    let lonely = 0;
    for (const i of wets) if (!wets.some((j) => j !== i && wall[i]![j]! >= 0.8)) lonely++;
    add('wetGroup', W.wetGroup * lonely);
    if (full) facts.wetGrouped = lonely === 0;
  }

  // Circulation share of the floor.
  let circ = ctx.circulationArea ?? 0;
  for (let i = 0; i < n; i++) if (CIRCULATION.has(specs[i]!.type)) circ += rectArea(rects[i]!);
  const ratio = circ / p.levelArea;
  facts.circulation = ratio;
  add('corridor', W.corridorBase * ratio * 100);
  if (ratio > CORRIDOR_TARGET) add('corridor', W.corridor * (ratio - CORRIDOR_TARGET) * 100);

  // Reachability: walk from the hall (or the room the entrance opens into) without crossing private rooms.
  const root = hasHall ? n : entranceRoom(p, rects);
  const strict = walk(p, wall, root, true);
  const loose = walk(p, wall, root, false);
  const unreachable: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!loose.has(i)) {
      unreachable.push(specs[i]!.name);
      add('unreachable', W.unreachable);
    } else if (!strict.has(i)) {
      add('throughBedroom', W.throughBedroom);
      if (full) facts.throughBedroom.push(specs[i]!.name);
    }
  }

  // The door at the entrance opens into a hall, foyer, corridor or living space, never into a bedroom or kitchen.
  if (ctx.entrance && (ctx.level ?? 0) === 0) {
    const sh = ctx.shell;
    const px = Math.min(sh.x + sh.w, Math.max(sh.x, ctx.entrance.x));
    const py = Math.min(sh.y + sh.h, Math.max(sh.y, ctx.entrance.y));
    let nearest = Infinity;
    let owner: RoomType | null = null;
    nodes.forEach((r, i) => {
      const t: RoomType = i < n ? specs[i]!.type : 'stair';
      for (const e of exteriorEdges(r, sh)) {
        if (e.length < 1.3) continue;
        const cx = Math.min(Math.max(px, Math.min(e.a.x, e.b.x)), Math.max(e.a.x, e.b.x));
        const cy = Math.min(Math.max(py, Math.min(e.a.y, e.b.y)), Math.max(e.a.y, e.b.y));
        const d = Math.hypot(px - cx, py - cy);
        if (d < nearest) {
          nearest = d;
          owner = t;
        }
      }
    });
    if (owner !== null && !ENTRANCE_OK.has(owner)) add('entrance', W.entranceRoom);
  }

  // Zoning (ground level): bedrooms away from the entrance, living areas near it.
  if (ctx.entrance && (ctx.level ?? 0) === 0) {
    const diag = Math.hypot(ctx.shell.w, ctx.shell.h);
    for (let i = 0; i < n; i++) {
      const s = specs[i]!;
      if (s.type !== 'bedroom' && s.type !== 'living' && s.type !== 'dining') continue;
      const d = dist(rectCenter(rects[i]!), ctx.entrance) / diag;
      add(
        'zoning',
        W.zoning *
          (s.type === 'bedroom' ? Math.max(0, 0.55 - d) * 1.8 : Math.max(0, d - 0.35) * 0.9),
      );
    }
  }

  // A view: the living room has an outside wall on the garden side.
  if (ctx.gardenSide) {
    for (let i = 0; i < n; i++) {
      if (specs[i]!.type !== 'living') continue;
      const ok = orient(ctx.gardenSide, rects[i]!, ctx.shell) >= 2;
      if (!ok) add('view', W.view);
      if (full) facts.views.push({ room: specs[i]!.name, ok });
    }
  }

  // Where the person wants rooms (bubble diagram) or where locked rooms were.
  if (ctx.hints) {
    const diag = Math.hypot(ctx.shell.w, ctx.shell.h);
    for (let i = 0; i < n; i++) {
      const h = ctx.hints[key(specs[i]!.name)];
      if (!h) continue;
      const d = dist(rectCenter(rects[i]!), h);
      add('hint', W.hint * (h.w ?? 1) * Math.min(1.5, d / (diag / 3)));
    }
  }

  // Orientation preferences.
  if (ctx.orientation?.sunny) {
    for (let i = 0; i < n; i++) {
      const t = specs[i]!.type;
      if (
        (t === 'bedroom' || t === 'living') &&
        orient(ctx.orientation.sunny, rects[i]!, ctx.shell) < 1.5
      )
        add('orientation', W.orientation * 0.5);
    }
  }
  if (ctx.orientation?.rules === 'vastu') {
    const c = rectCenter(ctx.shell);
    const where = (i: number): string => {
      const q = rectCenter(rects[i]!);
      const ns = q.y < c.y ? 'N' : 'S';
      const ew = q.x < c.x ? 'W' : 'E';
      return ns + ew;
    };
    specs.forEach((s, i) => {
      const w = where(i);
      if (s.type === 'kitchen' && w !== 'SE') add('orientation', W.orientation);
      if (s.type === 'bedroom' && /master/i.test(s.name) && w !== 'SW')
        add('orientation', W.orientation);
      if (s.type === 'prayer' && w !== 'NE') add('orientation', W.orientation);
    });
  }

  // Straight, continuous walls: every distinct partition line costs a little.
  const xs = new Set<number>();
  const ys = new Set<number>();
  const sh = ctx.shell;
  for (const r of nodes) {
    for (const x of [r.x, r.x + r.w])
      if (x > sh.x + 0.05 && x < sh.x + sh.w - 0.05) xs.add(Math.round(x * 10));
    for (const y of [r.y, r.y + r.h])
      if (y > sh.y + 0.05 && y < sh.y + sh.h - 0.05) ys.add(Math.round(y * 10));
  }
  facts.partitionLines = xs.size + ys.size;
  add('straightWalls', W.straightWalls * (xs.size + ys.size));

  let total = 0;
  for (const v of Object.values(terms)) total += v;
  return { score: total, terms, facts, unreachable, noWindow, narrow, unmetAdjacency: unmet };
}

/** The room the main entrance opens into when the skeleton has no hall (single-level plans). */
function entranceRoom(p: Prepared, rects: Rect[]): number {
  const e = p.ctx.entrance ?? rectCenter(p.ctx.shell);
  let best = 0;
  let bd = Infinity;
  rects.forEach((r, i) => {
    const cx = Math.min(r.x + r.w, Math.max(r.x, e.x));
    const cy = Math.min(r.y + r.h, Math.max(r.y, e.y));
    let d = Math.hypot(e.x - cx, e.y - cy);
    // Prefer rooms a person enters first.
    const t = p.specs[i]!.type;
    if (t === 'bedroom' || t === 'bathroom') d += 3;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function walk(p: Prepared, wall: number[][], root: number, strict: boolean): Set<number> {
  const n = p.n;
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length) {
    const u = queue.shift()!;
    const su = u < n ? p.specs[u]!.type : 'corridor';
    const through = !strict || u >= n || PASSABLE.has(su) || u === root;
    for (let v = 0; v < n; v++) {
      if (seen.has(v) || wall[u]![v]! < WALK_WALL) continue;
      if (!through && !ATTACHED.has(p.specs[v]!.type)) continue;
      seen.add(v);
      queue.push(v);
    }
  }
  return seen;
}

// ─────────────────────────── annealing ───────────────────────────

interface State {
  trees: (Node | null)[];
}

function cloneState(s: State): State {
  return { trees: s.trees.map((t) => (t ? clone(t) : null)) };
}

function roomRects(p: Prepared, st: State, regions: Rect[], areas: number[]): Rect[] {
  const rects: Rect[] = new Array(p.n);
  p.fixed.forEach((f, i) => {
    if (f) rects[i] = f;
  });
  st.trees.forEach((t, ri) => {
    if (t) build(t, regions[ri]!, areas, rects);
  });
  return rects;
}

function mutate(st: State, rnd: () => number): State | null {
  const next = cloneState(st);
  const roll = rnd();
  const regionsWith = next.trees.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const pickLeaf = (): { ri: number; leaf: Leaf } => {
    const all = regionsWith.flatMap((ri) =>
      leavesOf(next.trees[ri]!).map((leaf) => ({ ri, leaf })),
    );
    return all[Math.floor(rnd() * all.length)]!;
  };
  if (roll < 0.26) {
    // swap two rooms (the whole slot, so areas follow the room)
    const a = pickLeaf();
    const b = pickLeaf();
    if (a.leaf === b.leaf) return null;
    [a.leaf.i, b.leaf.i] = [b.leaf.i, a.leaf.i];
    return next;
  }
  if (roll < 0.42) {
    // move a room next to another one
    const a = pickLeaf();
    const b = pickLeaf();
    if (a.leaf.i === b.leaf.i) return null;
    const moved = a.leaf.i;
    const target = b.leaf.i;
    const left = without(next.trees[a.ri]!, moved);
    if (!left) return null; // would empty its region
    next.trees[a.ri] = left;
    next.trees[b.ri] = insertNextTo(
      next.trees[b.ri]!,
      target,
      moved,
      rnd() < 0.5 ? 'v' : 'h',
      rnd() < 0.5,
    );
    return next;
  }
  const ri = regionsWith[Math.floor(rnd() * regionsWith.length)]!;
  const splits = splitsOf(next.trees[ri]!);
  if (!splits.length) return null;
  const sp = splits[Math.floor(rnd() * splits.length)]!;
  if (roll < 0.56) sp.dir = sp.dir === 'v' ? 'h' : 'v';
  else if (roll < 0.68) [sp.a, sp.b] = [sp.b, sp.a];
  else if (roll < 0.9)
    sp.bias = Math.min(2.2, Math.max(0.45, sp.bias * Math.exp((rnd() - 0.5) * 0.7)));
  else {
    // rotate: (a (b c)) -> ((a b) c)
    if (sp.b.k === 'split') {
      const bb = sp.b;
      sp.b = bb.b;
      sp.a = { k: 'split', dir: bb.dir, bias: 1, a: sp.a, b: bb.a };
    } else if (sp.a.k === 'split') {
      const aa = sp.a;
      sp.a = aa.a;
      sp.b = { k: 'split', dir: aa.dir, bias: 1, a: aa.b, b: sp.b };
    } else return null;
  }
  return next;
}

/**
 * Straightens walls: partition lines that are less than ALIGN_GAP apart are pulled onto one line when every room next
 * to the moved line stays wide enough. Lines of the skeleton (hall, corridor, region edges, shell) never move.
 */
const ALIGN_GAP = 0.4;
function alignLines(p: Prepared, rects: Rect[], regions: Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  const frozen = { x: new Set<number>(), y: new Set<number>() };
  const q = (v: number) => Math.round(v * 1000);
  const freeze = (r: Rect) => {
    for (const x of [r.x, r.x + r.w]) frozen.x.add(q(x));
    for (const y of [r.y, r.y + r.h]) frozen.y.add(q(y));
  };
  freeze(p.ctx.shell);
  regions.forEach(freeze);
  if (p.ctx.hall.w > 0) freeze(p.ctx.hall);
  p.fixed.forEach((f) => f && freeze(f));
  for (const axis of ['x', 'y'] as const) {
    const lo = (r: Rect) => (axis === 'x' ? r.x : r.y);
    const len = (r: Rect) => (axis === 'x' ? r.w : r.h);
    const set = (r: Rect, a: number, b: number) => {
      if (axis === 'x') {
        r.x = a;
        r.w = b - a;
      } else {
        r.y = a;
        r.h = b - a;
      }
    };
    for (let pass = 0; pass < 12; pass++) {
      const lines = new Set<number>();
      out.forEach((r, i) => {
        if (p.fixed[i]) return;
        lines.add(q(lo(r)));
        lines.add(q(lo(r) + len(r)));
      });
      const sorted = [...lines].sort((a, b) => a - b);
      let moved = false;
      for (let k = 0; k + 1 < sorted.length && !moved; k++) {
        const a = sorted[k]!;
        const b = sorted[k + 1]!;
        if (b - a > ALIGN_GAP * 1000) continue;
        const aFrozen = frozen[axis].has(a);
        const bFrozen = frozen[axis].has(b);
        if (aFrozen && bFrozen) continue;
        // Move the free line onto the other (or the cheaper of two free lines).
        const tries: [number, number][] = aFrozen
          ? [[b, a]]
          : bFrozen
            ? [[a, b]]
            : [
                [a, b],
                [b, a],
              ];
        for (const [from, to] of tries) {
          const trial = out.map((r) => ({ ...r }));
          let ok = true;
          trial.forEach((r, i) => {
            if (p.fixed[i]) return;
            const s0 = q(lo(r));
            const e0 = q(lo(r) + len(r));
            if (s0 !== from && e0 !== from) return;
            const na = s0 === from ? to / 1000 : lo(r);
            const nb = e0 === from ? to / 1000 : lo(r) + len(r);
            set(r, na, nb);
            const need = Math.min(p.specs[i]!.minWidth, Math.min(out[i]!.w, out[i]!.h)) - 0.02;
            if (nb - na < 0.3 || Math.min(r.w, r.h) < need) ok = false;
          });
          if (!ok) continue;
          for (let i = 0; i < out.length; i++) out[i] = trial[i]!;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }
  return out;
}

export interface OptimizeOptions {
  /** Annealing steps per room (default 40 × tries / 24). */
  effort?: number;
}

/**
 * Lays out the rooms of one level in the skeleton's free regions. Same contract as the treemap `layoutLevel`:
 * returns every room's rectangle plus what is still unmet, and adds the score terms and facts for the explanation.
 */
export function optimizeLevel(
  rooms: RoomSpec[],
  ctx: LevelContext,
  seed: number,
  tries: number,
): LevelResult {
  const p = prepare(rooms, ctx);
  const rnd = rng(seed * 2654435761);
  const regions = ctx.regions;
  const areas = rooms.map((r) => r.area);

  // The starting arrangement: rooms in adjacency order dealt to the regions by area, each region a balanced tree.
  const freeSpecs = p.free.map((i) => rooms[i]!);
  const order = adjacencyOrder(freeSpecs).map((s) => rooms.indexOf(s));
  const groups = partition(
    order.map((i) => rooms[i]!),
    regions,
  ).map((g) => g.map((s) => rooms.indexOf(s)));
  const initial: State = {
    trees: groups.map((g, ri) => (g.length ? balanced(g, regions[ri]!, areas) : null)),
  };
  const evaluate = (st: State, full = false) => {
    const rects = roomRects(p, st, regions, areas);
    return { rects, s: score(p, rects, full) };
  };
  let cur = initial;
  let curEval = evaluate(cur);
  let best = cur;
  let bestScore = curEval.s.score;
  const nFree = p.free.length;
  const steps = Math.max(250, Math.min(16000, Math.round(tries * 70 * Math.max(1, nFree / 7))));
  if (nFree >= 2) {
    const t0 = 14;
    const t1 = 0.25;
    for (let it = 0; it < steps; it++) {
      const temp = t0 * Math.pow(t1 / t0, it / steps);
      const next = mutate(cur, rnd);
      if (!next) continue;
      const e = evaluate(next);
      const d = e.s.score - curEval.s.score;
      if (d <= 0 || rnd() < Math.exp(-d / temp)) {
        cur = next;
        curEval = e;
        if (e.s.score < bestScore - 1e-9) {
          best = next;
          bestScore = e.s.score;
        }
      }
    }
  }
  let final = evaluate(best, true);
  // Straighten nearly collinear walls, keeping the result only if it scores no worse.
  const aligned = alignLines(p, final.rects, regions);
  const alignedScore = score(p, aligned, true);
  if (alignedScore.score <= final.s.score + 1e-9) final = { rects: aligned, s: alignedScore };
  const out = new Map<string, Rect>();
  rooms.forEach((s, i) => out.set(s.name, final.rects[i]!));
  const f = final.s;
  return {
    rects: out,
    score: f.score,
    unmetAdjacency: f.unmetAdjacency,
    narrow: f.narrow,
    noWindow: f.noWindow,
    unreachable: f.unreachable,
    terms: f.terms,
    facts: f.facts,
  };
}
