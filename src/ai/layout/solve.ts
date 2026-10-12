import { layoutStair } from '../../scene3d/generators/stairs';
import { dist, rotate } from '../../geometry/vec';
import { fmtNum, t } from '../../i18n';
import type { Level, Point, RoomType, Stair, StairType } from '../../model/types';
import type { DesignIntent, RoomIntent } from '../schemas';
import { TYPE_DEFAULTS, floorFor } from './defaults';
import { furnishPlan } from './furnish';
import { type LevelContext, type LevelResult, type RoomSpec, layoutLevel } from './levelLayout';
import { type ColumnBox, type DoorRequest, planOpenings } from './openings';
import type { LayoutPlan, PlannedRoom, PlannedStair, Rect } from './plan';
import { rectArea, rectCenter } from './plan';
import { largestInnerRect } from './rect';
import { wallsFromRects } from './walls';

export interface SolveInput {
  intent: DesignIntent;
  footprint: Point[];
  entrance: { position: Point; direction: number };
  plumbing: Point[];
  columns: ColumnBox[];
  /** Slab-to-slab height available (m). */
  maxHeight: number;
  seed?: number;
  /** Search effort per level (orderings tried). */
  tries?: number;
}

const SLAB = 0.2;
const key = (s: string) => s.trim().toLowerCase();

interface Candidate {
  hall: Rect;
  regions: Rect[];
  /** Penalty for how well the hall sits relative to the requested position. */
  penalty: number;
  orientation: 'x' | 'y';
}

const mirror = (r: Rect, shell: Rect, fx: boolean, fy: boolean): Rect => ({
  x: fx ? shell.x * 2 + shell.w - r.x - r.w : r.x,
  y: fy ? shell.y * 2 + shell.h - r.y - r.h : r.y,
  w: r.w,
  h: r.h,
});

/** Every way of putting a hall of size hw × hh in a corner and cutting the rest into one or two rectangles. */
function hallCandidates(
  shell: Rect,
  hw: number,
  hh: number,
  pos: DesignIntent['stair']['position'],
  entrance: Point,
): Candidate[] {
  const out: Candidate[] = [];
  const dims: ['x' | 'y', number, number][] = [
    ['x', hw, hh],
    ['y', hh, hw],
  ];
  for (const [orientation, w, h] of dims) {
    if (w > shell.w - 0.1 || h > shell.h - 0.1) continue;
    for (const fx of [false, true]) {
      for (const fy of [false, true]) {
        const hall0: Rect = { x: shell.x, y: shell.y, w, h };
        const way1: Rect[] = [
          { x: shell.x + w, y: shell.y, w: shell.w - w, h },
          { x: shell.x, y: shell.y + h, w: shell.w, h: shell.h - h },
        ];
        const way2: Rect[] = [
          { x: shell.x, y: shell.y + h, w, h: shell.h - h },
          { x: shell.x + w, y: shell.y, w: shell.w - w, h: shell.h },
        ];
        for (const regions0 of [way1, way2]) {
          const regions = regions0
            .filter((r) => r.w > 1e-6 && r.h > 1e-6)
            .map((r) => mirror(r, shell, fx, fy));
          if (regions.some((r) => rectArea(r) < 5.5 || Math.min(r.w, r.h) < 1.8)) continue;
          const hall = mirror(hall0, shell, fx, fy);
          const c = rectCenter(hall);
          const shellCenter = rectCenter(shell);
          const wanted =
            pos === 'near-entrance'
              ? dist(c, entrance) * 0.9
              : pos === 'back'
                ? -dist(c, entrance) * 0.6
                : pos === 'left'
                  ? Math.abs(c.x - shell.x)
                  : pos === 'right'
                    ? Math.abs(c.x - (shell.x + shell.w))
                    : dist(c, shellCenter);
          // A hall that blocks the whole width of the shell splits it in two — avoid unless nothing else fits.
          const penalty = wanted + (regions.length === 1 ? 2 : 0);
          out.push({ hall, regions, penalty, orientation });
        }
      }
    }
  }
  return out;
}

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
  if (remaining > 10) {
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
export function solveLayout(input: SolveInput): LayoutPlan {
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
      if (type !== intent.stair.type) warnings.push(t('ai.warn.stairType').replace('{type}', type));
      break;
    }
  }
  if (nLevels === 1) {
    // Single level: no stair; one "region" that is the whole shell and a 0-size hall.
    candidates = [
      {
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

  let best: {
    cand: Candidate;
    results: LevelResult[];
    specs: RoomSpec[][];
    score: number;
    notes: string[];
    /** Region held by the double-height room (left open on the upper levels). */
    dh?: Rect;
  } | null = null;
  for (const cand of candidates) {
    const notes: string[] = [];
    const results: LevelResult[] = [];
    const specsPerLevel: RoomSpec[][] = [];
    let total = cand.penalty;
    let below: LevelResult | null = null;
    let belowSpecs: RoomSpec[] = [];
    // A double-height room takes a whole region by itself (the largest), on the ground level only.
    const dhWish = nLevels > 1 ? wishesByLevel[0]!.find((w) => w.intent.doubleHeight) : undefined;
    const dhIdx =
      dhWish && cand.regions.length >= 2
        ? cand.regions.reduce((bi, r, i) => (rectArea(r) > rectArea(cand.regions[bi]!) ? i : bi), 0)
        : -1;
    const dhRect = dhIdx >= 0 ? cand.regions[dhIdx]! : undefined;
    if (dhWish && !dhRect) total += 40;
    const freeRegions = dhRect ? cand.regions.filter((_, i) => i !== dhIdx) : cand.regions;
    for (let li = 0; li < nLevels; li++) {
      const available = freeRegions.reduce((s, r) => s + rectArea(r), 0);
      const wishes =
        li === 0 && dhRect ? wishesByLevel[0]!.filter((w) => w !== dhWish) : wishesByLevel[li]!;
      const scaled = scaleAreas(wishes, available, notes, intent.levels[li]!.name).specs;
      const specs =
        li === 0 && dhRect && dhWish
          ? [...scaled, { ...specFor(dhWish, rectArea(dhRect)), fixed: dhRect, doubleHeight: true }]
          : scaled;
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
      const wetBelow = below
        ? belowSpecs
            .filter((s) => s.wet && s.type === 'bathroom')
            .map((s) => rectCenter(below!.rects.get(s.name)!))
        : [];
      const roomsBelow = new Map<string, Rect>();
      if (below) for (const [name, r] of below.rects) roomsBelow.set(key(name), r);
      const ctx: LevelContext = {
        shell,
        hall: cand.hall,
        regions: freeRegions,
        plumbing: input.plumbing,
        wetBelow,
        roomsBelow,
      };
      const res = layoutLevel(specs, ctx, seed * 131 + li * 17, tries);
      total += res.score;
      results.push(res);
      specsPerLevel.push(specs);
      below = res;
      belowSpecs = specs;
    }
    if (!best || total < best.score)
      best = { cand, results, specs: specsPerLevel, score: total, notes, dh: dhRect };
  }
  const chosen = best!;
  warnings.push(...chosen.notes);

  // ── Planned rooms ──
  const rooms: PlannedRoom[] = [];
  const hallKey = new Map<number, string>();
  const style = intent.style;
  for (let li = 0; li < nLevels; li++) {
    const hasHall = chosen.cand.hall.w > 0;
    const rectsByName = new Map(chosen.results[li]!.rects);
    const fixed = [...(hasHall ? [chosen.cand.hall] : []), ...(chosen.dh ? [chosen.dh] : [])];
    const minW = new Map(chosen.specs[li]!.map((s) => [s.name, s.minWidth]));
    const snapped = snapToColumns(rectsByName, fixed, shell, columns, minW);
    if (snapped)
      warnings.push(
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
    // Report constraints that stayed unmet.
    const res = chosen.results[li]!;
    const lname = intent.levels[li]!.name;
    for (const [a, b] of res.unmetAdjacency)
      warnings.push(
        t('ai.warn.adjacency').replace('{a}', a).replace('{b}', b).replace('{level}', lname),
      );
    for (const n of res.narrow)
      warnings.push(
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
    requests.set(li, list);
  });
  const plan = planOpenings({
    rooms,
    shell,
    entrance: input.entrance,
    columns,
    requests,
    hallKey,
    ensuite,
  });
  warnings.push(...plan.warnings);
  const items = intent.furnish
    ? furnishPlan({ rooms, openings: plan.openings, columns, shell, floorToCeiling: ftc })
    : [];

  return {
    shell,
    levelNames: intent.levels.map((l) => l.name),
    floorToCeiling: ftc,
    rooms,
    walls,
    openings: plan.openings,
    items,
    stair,
    warnings: [...new Set(warnings)],
    score: chosen.score,
    title: intent.title,
  };
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
