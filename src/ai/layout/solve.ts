import { layoutStair } from '../../scene3d/generators/stairs';
import { dist, rotate } from '../../geometry/vec';
import { fmtNum, t } from '../../i18n';
import type { Level, Point, RoomType, Stair, StairType } from '../../model/types';
import type { DesignIntent, RoomIntent } from '../schemas';
import { TYPE_DEFAULTS, floorFor } from './defaults';
import { furnishPlan } from './furnish';
import {
  type LevelContext,
  type LevelResult,
  type Orientation,
  type RoomSpec,
  layoutLevel,
} from './levelLayout';
import { explain } from './explain';
import type { Emphasis } from './weights';
import { optimizeLevel, outsideLength } from './optimize';
import { type Candidate, hallCandidates, skeletons, wingsCandidate } from './archetypes';
import { type ColumnBox, type DoorRequest, planOpenings } from './openings';
import type { LayoutPlan, PlannedRoom, PlannedStair, Rect } from './plan';
import { rectArea, rectCenter } from './plan';
import { type SitePlanInput, planSite } from './site';
import { planSiteV2 } from './siteV2';
import { largestInnerRect } from './rect';
import { wallsFromRects } from './walls';

export interface SolveInput {
  intent: DesignIntent;
  footprint: Point[];
  entrance: { position: Point; direction: number };
  plumbing: Point[];
  columns: ColumnBox[];
  /** The plot boundary, when the project is a villa on a plot (outdoor zones are planned inside it). */
  plot?: Point[];
  /** Slab-to-slab height available (m). */
  maxHeight: number;
  seed?: number;
  /** Search effort per level (orderings tried). */
  tries?: number;
  /** `v2` (default): the annealing optimiser; `treemap`: the original squarified-treemap search, kept as a fallback. */
  engine?: 'v2' | 'treemap';
  /** Optional orientation preferences (off by default). */
  orientation?: Orientation;
  /** What the person asked to improve (see improve.ts). */
  emphasis?: Emphasis;
  /** Wall-clock time (ms) the search may take for `solveCandidates` (default 2500): refinement stops when it is used up. */
  budgetMs?: number;
  /** Internal: absolute `performance.now()` deadline for this search. */
  deadline?: number;
}

const SLAB = 0.2;
/** Share of a busy level kept for its own corridor (v2). */
const CORRIDOR_SHARE = 0.075;
const key = (s: string) => s.trim().toLowerCase();

/** Local-space bounding box of a stair's footprint. */
function stairBox(
  type: StairType,
  ftc: number,
  width: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const from = {
    id: 'a',
    name: 'a',
    index: 0,
    elevation: 0,
    floorToCeiling: ftc,
    slabThickness: SLAB,
    visible: true,
    locked: false,
  } as Level;
  const to = { ...from, id: 'b', index: 1, elevation: ftc + SLAB } as Level;
  const stair = {
    id: 's',
    fromLevelId: 'a',
    toLevelId: 'b',
    type,
    position: { x: 0, y: 0 },
    rotation: 0,
    width,
    railing: true,
  } as Stair;
  const layout = layoutStair(stair, from, to);
  const pts = layout.footprint.flat();
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

interface RoomWish {
  intent: RoomIntent;
  name: string;
  type: RoomType;
}

function specFor(w: RoomWish, area: number): RoomSpec {
  const d = TYPE_DEFAULTS[w.type];
  return {
    name: w.name,
    type: w.type,
    area,
    minWidth: w.intent.minWidth ?? d.minWidth,
    adjacency: w.intent.adjacency.map((a) => ({ room: a.room, connection: a.connection })),
    exteriorWall: w.intent.exteriorWall,
    needsWindow: w.intent.needsWindow ?? d.window,
    wet: w.intent.needsPlumbing ?? d.wet,
    above: w.intent.above,
  };
}

/**
 * Scales the wished areas so the rooms tile `available` m²: small rooms grow up to a per-type cap, leftover goes to
 * a circulation space, and too-large wishes shrink proportionally.
 */
function scaleAreas(
  wishes: RoomWish[],
  available: number,
  notes: string[],
  levelName: string,
  /** The skeleton already has its own corridor: spread leftover area over the rooms instead of adding one. */
  noExtra = false,
): { specs: RoomSpec[]; extra?: RoomSpec } {
  const target = wishes.map((w) => w.intent.targetArea);
  const caps = wishes.map((w, i) => target[i]! * TYPE_DEFAULTS[w.type].maxScale);
  const growth = wishes.map((w) => TYPE_DEFAULTS[w.type].growth + 0.01);
  const area = target.slice();
  let remaining = available - area.reduce((a, b) => a + b, 0);
  if (remaining < 0) {
    const f = available / (available - remaining);
    notes.push(
      t('ai.warn.scaledDown')
        .replace('{level}', levelName)
        .replace('{pct}', String(Math.round(f * 100))),
    );
    return { specs: wishes.map((w, i) => specFor(w, target[i]! * f)) };
  }
  // First grow rooms up to their per-type cap; if the shell is still not full, allow living spaces and bedrooms more.
  for (const stretch of [1, 1.6]) {
    for (let round = 0; round < 8 && remaining > 0.05; round++) {
      const open = area
        .map((a, i) =>
          a < caps[i]! * stretch - 1e-6 &&
          (stretch === 1 || TYPE_DEFAULTS[wishes[i]!.type].growth >= 2)
            ? i
            : -1,
        )
        .filter((i) => i >= 0);
      if (!open.length) break;
      const totalG = open.reduce((sum, i) => sum + growth[i]! * target[i]!, 0);
      let used = 0;
      for (const i of open) {
        const add = Math.min(
          (remaining * growth[i]! * target[i]!) / totalG,
          caps[i]! * stretch - area[i]!,
        );
        area[i]! += add;
        used += add;
      }
      remaining -= used;
    }
  }
  const specs = wishes.map((w, i) => specFor(w, area[i]!));
  if (remaining > 10 && !noExtra) {
    const extra: RoomSpec = {
      name: 'Corridor',
      type: 'corridor',
      area: remaining,
      minWidth: 1.0,
      adjacency: [],
      exteriorWall: 'none',
      needsWindow: false,
      wet: false,
    };
    return { specs: [...specs, extra], extra };
  }
  // Tiny leftover: spread it over every room.
  const total = area.reduce((a, b) => a + b, 0);
  return { specs: specs.map((s) => ({ ...s, area: (s.area / total) * available })) };
}

/** Moves partition lines onto structural columns where that keeps every room wide enough. */
function snapToColumns(
  rects: Map<string, Rect>,
  fixed: Rect[],
  shell: Rect,
  columns: ColumnBox[],
  minWidth: Map<string, number>,
): number {
  let snapped = 0;
  const isFixedEdge = (v: number, axis: 'x' | 'y') =>
    fixed.some((f) =>
      axis === 'x'
        ? Math.abs(f.x - v) < 1e-6 || Math.abs(f.x + f.w - v) < 1e-6
        : Math.abs(f.y - v) < 1e-6 || Math.abs(f.y + f.h - v) < 1e-6,
    );
  for (const c of columns) {
    for (const axis of ['x', 'y'] as const) {
      const target = axis === 'x' ? c.position.x : c.position.y;
      const lo = axis === 'x' ? shell.x : shell.y;
      const hi = axis === 'x' ? shell.x + shell.w : shell.y + shell.h;
      const lines = new Set<number>();
      for (const r of rects.values()) {
        const a = axis === 'x' ? r.x : r.y;
        const b = axis === 'x' ? r.x + r.w : r.y + r.h;
        for (const v of [a, b])
          if (v > lo + 0.3 && v < hi - 0.3 && !isFixedEdge(v, axis))
            lines.add(Math.round(v * 1e4) / 1e4);
      }
      const near = [...lines]
        .filter((v) => Math.abs(v - target) <= 0.6)
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      if (near === undefined || Math.abs(near - target) < 1e-6) continue;
      // The column must actually be next to this partition (inside the strip of rooms it separates).
      const trial = new Map<string, Rect>();
      let ok = true;
      for (const [name, r] of rects) {
        const a = axis === 'x' ? r.x : r.y;
        const len = axis === 'x' ? r.w : r.h;
        const b = a + len;
        let na = a;
        let nb = b;
        if (Math.abs(a - near) < 1e-4) na = target;
        if (Math.abs(b - near) < 1e-4) nb = target;
        const nr = axis === 'x' ? { ...r, x: na, w: nb - na } : { ...r, y: na, h: nb - na };
        if (
          Math.min(nr.w, nr.h) < (minWidth.get(name) ?? 1) - 0.05 &&
          Math.min(nr.w, nr.h) < Math.min(r.w, r.h)
        )
          ok = false;
        trial.set(name, nr);
      }
      if (!ok) continue;
      for (const [name, r] of trial) rects.set(name, r);
      snapped++;
    }
  }
  return snapped;
}

interface Suite {
  bed: RoomWish;
  attached: RoomWish[];
}

/** Bedrooms with their own bathroom / closet are laid out as one block and split afterwards, so the rooms touch. */
function groupSuites(wishes: RoomWish[]): { merged: RoomWish[]; suites: Suite[] } {
  const claimed = new Set<RoomWish>();
  const suites: Suite[] = [];
  for (const bed of wishes.filter((w) => w.type === 'bedroom')) {
    const attached = bed.intent.adjacency
      .filter((a) => a.connection === 'door')
      .map((a) => wishes.find((w) => key(w.name) === key(a.room)))
      .filter(
        (w): w is RoomWish =>
          !!w && !claimed.has(w) && (w.type === 'bathroom' || w.type === 'walk-in-closet'),
      );
    if (!attached.length) continue;
    attached.forEach((a) => claimed.add(a));
    suites.push({ bed, attached });
  }
  const merged = wishes
    .filter((w) => !claimed.has(w))
    .map((w) => {
      const s = suites.find((x) => x.bed === w);
      if (!s) return w;
      const area = w.intent.targetArea + s.attached.reduce((a, x) => a + x.intent.targetArea, 0);
      const names = new Set(s.attached.map((a) => key(a.name)));
      return {
        ...w,
        intent: {
          ...w.intent,
          targetArea: area,
          adjacency: w.intent.adjacency.filter((a) => !names.has(key(a.room))),
        },
      };
    });
  return { merged, suites };
}

/** Splits each suite's block: the bedroom first along the long side, its bathroom / closet side by side behind it. */
function expandSuites(
  res: LevelResult,
  specs: RoomSpec[],
  suites: Suite[],
  shell: Rect,
  /** Put the bedroom at the end of its block that has the outside wall (the optimiser's engine only). */
  windowEnd: boolean,
): { res: LevelResult; specs: RoomSpec[] } {
  const rects = new Map(res.rects);
  const out: RoomSpec[] = [];
  for (const spec of specs) {
    const suite = suites.find((s) => key(s.bed.name) === key(spec.name));
    const block = rects.get(spec.name);
    if (!suite || !block) {
      out.push(spec);
      continue;
    }
    const bedT = suite.bed.intent.targetArea;
    const attT = suite.attached.map((a) => a.intent.targetArea);
    const total = bedT + attT.reduce((a, b) => a + b, 0);
    const alongY = block.h >= block.w;
    const long = alongY ? block.h : block.w;
    const bedLen = Math.min(long - 1.6, Math.max(1.8, (long * bedT) / total));
    // The bedroom takes the end of the block that has the outside wall (windows), the bathroom and closet the other.
    const first: Rect = alongY ? { ...block, h: bedLen } : { ...block, w: bedLen };
    const last: Rect = alongY
      ? { ...block, y: block.y + long - bedLen, h: bedLen }
      : { ...block, x: block.x + long - bedLen, w: bedLen };
    const flip =
      windowEnd &&
      outsideLength(last, shell, undefined) > outsideLength(first, shell, undefined) + 1e-6;
    const bedRect = flip ? last : first;
    rects.set(spec.name, bedRect);
    out.push({ ...spec, area: rectArea(bedRect) });
    const band: Rect = alongY
      ? { x: block.x, y: flip ? block.y : block.y + bedLen, w: block.w, h: long - bedLen }
      : { x: flip ? block.x : block.x + bedLen, y: block.y, w: long - bedLen, h: block.h };
    const attSum = attT.reduce((a, b) => a + b, 0);
    let cursor = alongY ? band.x : band.y;
    suite.attached.forEach((a, i) => {
      const side = alongY ? band.w : band.h;
      const len =
        i === suite.attached.length - 1
          ? (alongY ? band.x + band.w : band.y + band.h) - cursor
          : (side * attT[i]!) / attSum;
      const r: Rect = alongY ? { ...band, x: cursor, w: len } : { ...band, y: cursor, h: len };
      cursor += len;
      rects.set(a.name, r);
      out.push({ ...specFor(a, rectArea(r)), fixed: undefined });
    });
  }
  return { res: { ...res, rects }, specs: out };
}

const HALL_NAMES = [
  'hall',
  'entrance hall',
  'entrance',
  'landing',
  'staircase',
  'stairs',
  'stair hall',
];

/**
 * Turns a DesignIntent into a complete layout plan: aligned stair hall, rooms tiled to the shell
 * (adjacency-aware), walls, doors, windows and (optionally) furniture. Deterministic for a given seed.
 */
function search(input: SolveInput) {
  const { intent, columns } = input;
  const warnings: string[] = [];
  const { rect: shell, exact } = largestInnerRect(input.footprint);
  if (!exact) warnings.push(t('ai.warn.shellApprox'));
  const nLevels = intent.levels.length;
  const ftc =
    Math.round(Math.min(3.0, (input.maxHeight - SLAB * (nLevels - 1)) / nLevels) * 100) / 100;
  if (ftc < 2.4) warnings.push(t('ai.warn.lowCeiling').replace('{h}', fmtNum(ftc, 2)));
  const seed = input.seed ?? 1;
  const tries = input.tries ?? 24;

  // ── Stair & hall ──
  const stairTypes: StairType[] = [
    intent.stair.type,
    ...(['L', 'U', 'straight', 'spiral'] as StairType[]).filter((s) => s !== intent.stair.type),
  ];
  const width = 1.0;
  let stairType = stairTypes[0]!;
  let box = stairBox(stairType, ftc, width);
  let candidates: Candidate[] = [];
  let hallDims: { w: number; h: number } | null = null;
  for (const type of stairTypes) {
    const b = stairBox(type, ftc, width);
    const hallL = b.maxX - b.minX + 1.0;
    const hallW = b.maxY - b.minY + 0.4;
    const cs =
      nLevels > 1
        ? hallCandidates(shell, hallL, hallW, intent.stair.position, input.entrance.position)
        : [];
    if (cs.length) {
      stairType = type;
      box = b;
      candidates = cs;
      hallDims = { w: hallL, h: hallW };
      if (type !== intent.stair.type) warnings.push(t('ai.warn.stairType').replace('{type}', type));
      break;
    }
  }
  if (nLevels === 1) {
    // Single level: no stair; one "region" that is the whole shell and a 0-size hall.
    candidates = [
      {
        archetype: 'compact-square',
        hall: { x: shell.x, y: shell.y, w: 0, h: 0 },
        regions: [shell],
        penalty: 0,
        orientation: 'x',
      },
    ];
  } else if (!candidates.length) {
    warnings.push(t('ai.warn.noStairRoom'));
    candidates = [
      {
        archetype: 'compact-square',
        hall: { x: shell.x, y: shell.y, w: 0, h: 0 },
        regions: [shell],
        penalty: 100,
        orientation: 'x',
      },
    ];
  }

  // ── Wishes per level (the hall replaces any stair/hall room the design listed) ──
  const wishesByLevel: RoomWish[][] = intent.levels.map((lvl) =>
    lvl.rooms
      .filter(
        (r) =>
          !(
            r.type === 'stair' ||
            (r.type === 'corridor' && HALL_NAMES.includes(key(r.name)) && nLevels > 1)
          ),
      )
      .map((r) => ({ intent: r, name: r.name, type: r.type })),
  );
  // Names must be unique inside a level.
  wishesByLevel.forEach((list) => {
    const seen = new Map<string, number>();
    for (const w of list) {
      const k = key(w.name);
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      if (n > 1) w.name = `${w.name} ${n}`;
    }
  });

  // ── Wings strategy (villas): one level, central hall + two wings ──
  const wingWishes = new Map<'foyer' | 'hall', RoomWish>();
  let wingsCand: Candidate | null = null;
  if (intent.strategy === 'wings') {
    const first = wishesByLevel[0]!;
    const foyerWish = first.find((w) => w.type === 'foyer');
    const hallWish =
      first.find((w) => w.type === 'living') ??
      first.slice().sort((a, b) => b.intent.targetArea - a.intent.targetArea)[0];
    wingsCand =
      nLevels === 1 && hallWish
        ? wingsCandidate(shell, input.entrance.position, !!foyerWish && foyerWish !== hallWish)
        : null;
    if (wingsCand) {
      if (foyerWish && foyerWish !== hallWish) wingWishes.set('foyer', foyerWish);
      wingWishes.set('hall', hallWish!);
    } else warnings.push(t('ai.warn.noWings'));
  }
  const fixedWishes = new Set<RoomWish>(wingWishes.values());
  const dhWish = nLevels > 1 ? wishesByLevel[0]!.find((w) => w.intent.doubleHeight) : undefined;
  if (input.engine === 'treemap') {
    if (wingsCand) candidates = [wingsCand];
  } else {
    // The optimiser chooses between every archetype that suits the brief and the shell.
    const proposed = skeletons({
      shell,
      entrance: input.entrance.position,
      nLevels,
      hall: nLevels > 1 ? hallDims : null,
      stairPosition: intent.stair.position,
      wings: wingsCand ? { foyer: wingWishes.has('foyer') } : null,
      doubleHeight: !!dhWish,
      columns,
      villa: !!input.plot,
    });
    if (proposed.length && (nLevels === 1 || hallDims)) candidates = proposed;
    else if (wingsCand) candidates = [wingsCand];
  }

  // Scores every skeleton with the search effort `effort` (orderings tried per level).
  interface Chosen {
    cand: Candidate;
    results: LevelResult[];
    specs: RoomSpec[][];
    score: number;
    notes: string[];
    /** Region held by the double-height room (left open on the upper levels). */
    dh?: Rect;
  }
  const evaluateSkeleton = (cand: Candidate, effort: number): Chosen => {
    const notes: string[] = [];
    const results: LevelResult[] = [];
    const specsPerLevel: RoomSpec[][] = [];
    const isWings = !!cand.fixedRects;
    let total = cand.penalty;
    let below: LevelResult | null = null;
    let belowSpecs: RoomSpec[] = [];
    // A double-height room takes a whole region by itself (the largest), on the ground level only.
    const dhIdx =
      dhWish && cand.regions.length >= 2
        ? cand.regions.reduce((bi, r, i) => (rectArea(r) > rectArea(cand.regions[bi]!) ? i : bi), 0)
        : -1;
    const dhRect = dhIdx >= 0 ? cand.regions[dhIdx]! : undefined;
    if (dhWish && !dhRect) total += 40;
    const freeRegions = dhRect ? cand.regions.filter((_, i) => i !== dhIdx) : cand.regions;
    const wingsFixed = (cand.fixedRects ?? []).filter((f) => wingWishes.has(f.role));
    const courtArea = (cand.courts ?? []).reduce((s, r) => s + rectArea(r), 0);
    for (let li = 0; li < nLevels; li++) {
      const available = freeRegions.reduce((s, r) => s + rectArea(r), 0);
      const wishes = (
        li === 0 && dhRect ? wishesByLevel[0]!.filter((w) => w !== dhWish) : wishesByLevel[li]!
      ).filter((w) => !(li === 0 && isWings && fixedWishes.has(w)));
      const grouped = li === 0 && isWings ? groupSuites(wishes) : null;
      // Busy levels get a flexible corridor of their own: the optimiser decides where it runs (v2 only).
      const wantsCorridor =
        input.engine !== 'treemap' && !cand.rooms?.length && wishes.length >= 6 && !isWings;
      const scaledAll = scaleAreas(
        grouped ? grouped.merged : wishes,
        wantsCorridor ? available * (1 - CORRIDOR_SHARE) : available,
        notes,
        intent.levels[li]!.name,
        !!cand.rooms?.length || wantsCorridor,
      ).specs;
      const scaled = wantsCorridor
        ? [
            ...scaledAll,
            {
              name: 'Corridor',
              type: 'corridor' as const,
              area: available * CORRIDOR_SHARE,
              minWidth: 1.0,
              adjacency: [],
              exteriorWall: 'none' as const,
              needsWindow: false,
              wet: false,
            },
          ]
        : scaledAll;
      const withDh =
        li === 0 && dhRect && dhWish
          ? [...scaled, { ...specFor(dhWish, rectArea(dhRect)), fixed: dhRect, doubleHeight: true }]
          : scaled;
      const skeletonRooms: RoomSpec[] = (cand.rooms ?? [])
        .filter((r) => r.levels === 'all' || li === 0)
        .map((r) => ({
          name: r.name,
          type: r.type,
          area: rectArea(r.rect),
          minWidth: 1.0,
          adjacency: [],
          exteriorWall: 'none' as const,
          needsWindow: false,
          wet: false,
          fixed: r.rect,
        }));
      const specs =
        li === 0
          ? [
              ...withDh,
              ...wingsFixed.map((f) => ({
                ...specFor(wingWishes.get(f.role)!, rectArea(f.rect)),
                fixed: f.rect,
              })),
              ...skeletonRooms,
            ]
          : [...withDh, ...skeletonRooms];
      if (specs.filter((s) => !s.fixed).length < freeRegions.length) {
        total += 1000;
        results.push({
          rects: new Map(),
          score: 1000,
          unmetAdjacency: [],
          narrow: [],
          noWindow: [],
          unreachable: [],
        });
        specsPerLevel.push(specs);
        continue;
      }
      const wetSpecs = below ? belowSpecs.filter((s) => s.wet && s.type === 'bathroom') : [];
      const wetBelow = wetSpecs.map((s) => rectCenter(below!.rects.get(s.name)!));
      const roomsBelow = new Map<string, Rect>();
      if (below) for (const [name, r] of below.rects) roomsBelow.set(key(name), r);
      const ctx: LevelContext = {
        shell,
        hall: cand.reach ?? cand.hall,
        regions: freeRegions,
        plumbing: input.plumbing,
        wetBelow,
        wetBelowRects: wetSpecs.map((s) => below!.rects.get(s.name)!),
        roomsBelow,
        level: li,
        entrance: input.entrance.position,
        levelArea: shell.w * shell.h - courtArea,
        circulationArea: isWings ? 0 : rectArea(cand.hall),
        outdoors: cand.courts,
        gardenSide: input.plot ? gardenSide(input.entrance.direction) : undefined,
        orientation: input.orientation,
        emphasis: input.emphasis,
      };
      const laid = (input.engine === 'treemap' ? layoutLevel : optimizeLevel)(
        specs,
        ctx,
        seed * 131 + li * 17,
        input.engine === 'treemap' && isWings ? Math.max(effort, 240) : effort,
      );
      const expanded =
        grouped && grouped.suites.length
          ? expandSuites(laid, specs, grouped.suites, shell, input.engine !== 'treemap')
          : { res: laid, specs };
      total += laid.score;
      results.push(expanded.res);
      specsPerLevel.push(expanded.specs);
      below = expanded.res;
      belowSpecs = expanded.specs;
    }
    return { cand, results, specs: specsPerLevel, score: total, notes, dh: dhRect };
  };

  // Treemap: every skeleton at full effort. Optimiser: a quick pass over all of them, then the best few refined.
  let ranked: Chosen[];
  if (input.engine === 'treemap') {
    ranked = candidates.map((c) => evaluateSkeleton(c, tries)).sort((a, b) => a.score - b.score);
  } else {
    const quick = candidates
      .map((c) => evaluateSkeleton(c, Math.max(3, Math.round(tries / 6))))
      .sort((a, b) => a.score - b.score);
    // Keep the best skeleton of every archetype in the refinement round, so the candidates differ in kind.
    const byKind = new Map<string, Chosen>();
    for (const q of quick) if (!byKind.has(q.cand.archetype)) byKind.set(q.cand.archetype, q);
    const finalists = [
      ...new Set([...[...byKind.values()], ...quick.slice(0, 3)].map((q) => q.cand)),
    ].slice(0, 7);
    // Refine best-first; stop when the time budget is used up (always at least two, so there is a choice).
    const refined: Chosen[] = [];
    for (const c of finalists) {
      if (refined.length >= 2 && input.deadline && performance.now() > input.deadline) break;
      refined.push(evaluateSkeleton(c, tries));
    }
    ranked = refined.sort((a, b) => a.score - b.score);
  }

  const assemble = (chosen: Chosen): LayoutPlan => {
    const wl: string[] = [...warnings, ...chosen.notes];

    // ── Planned rooms ──
    const rooms: PlannedRoom[] = [];
    const hallKey = new Map<number, string>();
    const style = intent.style;
    for (let li = 0; li < nLevels; li++) {
      const hasHall = chosen.cand.hall.w > 0;
      const rectsByName = new Map(chosen.results[li]!.rects);
      const fixed = [
        ...(hasHall ? [chosen.cand.hall] : []),
        ...(chosen.dh ? [chosen.dh] : []),
        ...(chosen.cand.fixedRects ?? []).map((f) => f.rect),
        ...(chosen.cand.courts ?? []),
        ...(chosen.cand.rooms ?? []).map((r) => r.rect),
      ];
      const minW = new Map(chosen.specs[li]!.map((s) => [s.name, s.minWidth]));
      const snapped = snapToColumns(rectsByName, fixed, shell, columns, minW);
      if (snapped)
        wl.push(
          t('ai.warn.snapped')
            .replace('{n}', String(snapped))
            .replace('{level}', intent.levels[li]!.name),
        );
      if (hasHall) {
        const name = li === 0 ? 'Entrance hall' : 'Landing';
        const k = `L${li}:${name}`;
        hallKey.set(li, k);
        rooms.push({
          key: k,
          level: li,
          name,
          type: li === 0 ? 'stair' : 'corridor',
          rect: chosen.cand.hall,
          wantedArea: rectArea(chosen.cand.hall),
          minWidth: 1.0,
          floorMaterial: 'floor-tile-large',
          ceilingMaterial: 'paint-white',
        });
      }
      for (const spec of chosen.specs[li]!) {
        const rect = rectsByName.get(spec.name);
        if (!rect) continue;
        rooms.push({
          key: `L${li}:${spec.name}`,
          level: li,
          name: spec.name,
          type: spec.type,
          rect,
          wantedArea: spec.area,
          minWidth: spec.minWidth,
          floorMaterial: floorFor(spec.type, style),
          ceilingMaterial: 'paint-white',
          doubleHeight: spec.doubleHeight,
        });
      }
      // Above a double-height room the plan is open: keep its walls (a guard line) but no floor, doors or furniture.
      if (li > 0 && chosen.dh) {
        rooms.push({
          key: `L${li}:Open to below`,
          level: li,
          name: 'Open to below',
          type: 'other',
          rect: chosen.dh,
          wantedArea: rectArea(chosen.dh),
          minWidth: 1,
          floorMaterial: 'floor-oak',
          ceilingMaterial: 'paint-white',
          void: true,
        });
      }
      // Open courts: an outdoor room on the ground level; above it there is simply no room (open to the sky).
      if (li === 0)
        (chosen.cand.courts ?? []).forEach((court) => {
          const garden = chosen.cand.archetype === 'villa-l-garden';
          rooms.push({
            key: `L0:${garden ? 'Garden' : 'Courtyard'}`,
            level: 0,
            name: garden ? 'Garden' : 'Courtyard',
            type: 'outdoor',
            rect: court,
            wantedArea: rectArea(court),
            minWidth: 1.5,
            floorMaterial: 'decking',
            ceilingMaterial: 'paint-white',
          });
        });
      // Report constraints that stayed unmet.
      const res = chosen.results[li]!;
      const lname = intent.levels[li]!.name;
      for (const [a, b] of res.unmetAdjacency)
        wl.push(
          t('ai.warn.adjacency').replace('{a}', a).replace('{b}', b).replace('{level}', lname),
        );
      for (const n of res.narrow)
        wl.push(
          t('ai.warn.narrow')
            .replace('{room}', n.name)
            .replace('{w}', fmtNum(n.width, 1))
            .replace('{want}', fmtNum(n.wanted, 1)),
        );
    }

    // ── Stair ──
    const stair: PlannedStair = placeStair(
      chosen.cand.hall,
      stairType,
      box,
      width,
      input.entrance.position,
    );

    // ── Walls, openings, furniture ──
    const walls = Array.from({ length: nLevels }, (_, li) =>
      wallsFromRects(
        rooms.filter((r) => r.level === li).map((r) => r.rect),
        shell,
        li,
        [
          ...(chosen.cand.courts ?? []),
          ...rooms.filter((r) => r.level === li && r.type === 'outdoor').map((r) => r.rect),
        ],
      ),
    ).flat();
    const requests = new Map<number, DoorRequest[]>();
    const ensuite = new Set<string>();
    intent.levels.forEach((_lvl, li) => {
      const list: DoorRequest[] = [];
      for (const wish of wishesByLevel[li]!) {
        for (const adj of wish.intent.adjacency) {
          list.push({ a: wish.name, b: adj.room, connection: adj.connection });
          const other = wishesByLevel[li]!.find((w) => key(w.name) === key(adj.room));
          if (
            other &&
            ((wish.type === 'bedroom' && other.type === 'bathroom') ||
              (wish.type === 'bathroom' && other.type === 'bedroom'))
          ) {
            ensuite.add(`L${li}:${wish.name}`);
            ensuite.add(`L${li}:${other.name}`);
          }
        }
      }
      if (li === 0 && chosen.cand.fixedRects && wingWishes.has('foyer') && wingWishes.has('hall'))
        list.push({
          a: wingWishes.get('foyer')!.name,
          b: wingWishes.get('hall')!.name,
          connection: 'open',
        });
      requests.set(li, list);
    });
    const wingsHall = wingWishes.get('hall');
    if (wingsHall && chosen.cand.fixedRects) hallKey.set(0, `L0:${wingsHall.name}`);
    else if (!hallKey.has(0) && chosen.cand.rooms?.length)
      hallKey.set(0, `L0:${chosen.cand.rooms[0]!.name}`);
    const plan = planOpenings({
      rooms,
      shell,
      entrance: input.entrance,
      columns,
      requests,
      hallKey,
      ensuite,
    });
    wl.push(...plan.warnings);
    const items = intent.furnish
      ? furnishPlan({ rooms, openings: plan.openings, columns, shell, floorToCeiling: ftc })
      : [];

    const site =
      input.plot && input.plot.length >= 3 && intent.site
        ? (input.engine === 'treemap' ? planSite : (i: SitePlanInput) => planSiteV2(i, seed))({
            intent: intent.site,
            plot: input.plot,
            building: shell,
            entrance: input.entrance,
          })
        : undefined;
    if (site) wl.push(...site.warnings);
    return {
      shell,
      levelNames: intent.levels.map((l) => l.name),
      floorToCeiling: ftc,
      rooms,
      walls,
      openings: plan.openings,
      items,
      stair,
      warnings: [...new Set(wl)],
      score: chosen.score,
      title: intent.title,
      site,
      archetype: chosen.cand.archetype,
      levelTerms: chosen.results.map((r) => r.terms ?? {}),
      breakdown: explain(
        chosen.results,
        chosen.specs,
        intent.levels.map((l) => l.name),
      ),
    };
  };
  return { ranked, assemble };
}

/** The garden is on the side of the building opposite the entrance. */
function gardenSide(direction: number): 'N' | 'S' | 'E' | 'W' {
  const nx = Math.cos(direction);
  const ny = Math.sin(direction);
  if (Math.abs(ny) >= Math.abs(nx)) return ny >= 0 ? 'N' : 'S';
  return nx >= 0 ? 'W' : 'E';
}

/** Centres the stair in its hall with the bottom step at the end nearest the entrance. */
function placeStair(
  hall: Rect,
  type: StairType,
  box: { minX: number; maxX: number; minY: number; maxY: number },
  width: number,
  entrance: Point,
): PlannedStair {
  const rotations = hall.w >= hall.h ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
  const hc = rectCenter(hall);
  let best: { rotation: number; position: Point; d: number } | null = null;
  for (const rotation of type === 'spiral' ? [0] : rotations) {
    const corners = [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ].map((p) => rotate(p, rotation));
    const cx = (Math.min(...corners.map((p) => p.x)) + Math.max(...corners.map((p) => p.x))) / 2;
    const cy = (Math.min(...corners.map((p) => p.y)) + Math.max(...corners.map((p) => p.y))) / 2;
    const position = { x: hc.x - cx, y: hc.y - cy };
    const bottom = {
      x: position.x + rotate({ x: 0, y: 0 }, rotation).x,
      y: position.y + rotate({ x: 0, y: 0 }, rotation).y,
    };
    const d = dist(bottom, entrance);
    if (!best || d < best.d) best = { rotation, position, d };
  }
  return { type, position: best!.position, rotation: best!.rotation, width, roomRect: hall };
}

/** One plan: the best the engine finds (rank 0), or the `rank`-th best skeleton. */
export function solveLayout(input: SolveInput, rank = 0): LayoutPlan {
  const found = search(input);
  return found.assemble(found.ranked[Math.min(rank, found.ranked.length - 1)]!);
}

/** How different two plans are: the share of rooms that moved more than 1.5 m or are missing (0 = same plan). */
export function planDistance(a: LayoutPlan, b: LayoutPlan): number {
  const centres = new Map(a.rooms.filter((r) => !r.void).map((r) => [r.key, rectCenter(r.rect)]));
  let moved = 0;
  let total = 0;
  for (const r of b.rooms.filter((r) => !r.void)) {
    total++;
    const c = centres.get(r.key);
    if (!c || dist(c, rectCenter(r.rect)) > 1.5) moved++;
  }
  return total ? moved / total : 0;
}

/**
 * The best `n` different plans: several seeds and every kind of skeleton are tried, and a plan only joins the
 * list when it is clearly unlike those already chosen (not a near-duplicate with one room nudged).
 */
export function solveCandidates(input: SolveInput, n = 3): LayoutPlan[] {
  const base = input.seed ?? 1;
  const pool: LayoutPlan[] = [];
  const seeds = input.engine === 'treemap' ? n : Math.max(2, Math.min(3, n));
  const start = performance.now();
  const budget = input.budgetMs ?? 2500;
  for (let k = 0; k < seeds; k++) {
    const found = search({
      ...input,
      seed: base + k,
      deadline: start + (budget * (k + 1)) / seeds,
    });
    for (const r of found.ranked.slice(0, input.engine === 'treemap' ? 1 : 3))
      pool.push(found.assemble(r));
  }
  // A plan with an unmet wish or an unreachable room counts as much worse than its score says.
  const defects = (p: LayoutPlan) =>
    (p.breakdown ?? []).filter(
      (b) => !b.ok && ['adjacency', 'ensuite', 'reach', 'narrow', 'daylight'].includes(b.id),
    ).length;
  const rank = (p: LayoutPlan) => p.score + 30 * defects(p);
  pool.sort((a, b) => rank(a) - rank(b));
  const out: LayoutPlan[] = [];
  // A candidate must be nearly as good as the best one; the floor is only lowered when nothing else is left.
  const best = pool[0] ? rank(pool[0]) : 0;
  for (const [threshold, slack] of [
    [0.35, 0.18],
    [0.2, 0.18],
    [0.35, 0.6],
    [0.1, 0.6],
    [0, 1e9],
  ] as const) {
    for (const p of pool) {
      if (out.length >= n) break;
      if (out.includes(p)) continue;
      if (rank(p) > best + Math.max(10, best * slack)) continue;
      if (out.every((q) => planDistance(q, p) > threshold)) out.push(p);
    }
  }
  return out.sort((a, b) => rank(a) - rank(b));
}
