import { BoxGeometry, ExtrudeGeometry, type BufferGeometry, CylinderGeometry } from 'three';
import { pointInPolygon } from '../../geometry/polygon';
import { type Vec2, add, rotate } from '../../geometry/vec';
import type { Level, Project, Stair } from '../../model/types';
import { type Part, mergeAll, shapeFromPolygon, toRing } from './common';

export const TARGET_RISER = 0.18;
export const MIN_TREAD = 0.25;
export const DEFAULT_TREAD = 0.27;
export const MIN_HEADROOM = 2.0;
const HANDRAIL_HEIGHT = 0.9;

/** One step: a polygon in stair-local plan coordinates raised from `bottom` to `top`. */
interface Step {
  poly: Vec2[];
  top: number;
  bottom: number;
}

interface Run {
  /** Step centers along this run with their top heights, for railings. */
  points: { p: Vec2; top: number }[];
  lateral: Vec2;
  width: number;
}

export interface StairLayout {
  steps: Step[];
  runs: Run[];
  /** Total rise from the lower floor to the upper floor. */
  rise: number;
  riserCount: number;
  riser: number;
  tread: number;
  width: number;
  /** Index of the first step whose headroom under the upper slab drops below 2 m (void starts here). */
  voidFromStep: number;
  warnings: string[];
  /** Local-space rings of the footprint of steps from `voidFromStep` on (what the upper slab must open). */
  voidPolys: Vec2[][];
  /** Local-space rings of the whole stair footprint. */
  footprint: Vec2[][];
  spiralCenterRadius?: number;
}

const rect = (x0: number, x1: number, y0: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function expand(poly: Vec2[], m: number): Vec2[] {
  // Only used for axis-aligned boxes in local space.
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return rect(Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...ys) - m, Math.max(...ys) + m);
}

export const stairRise = (from: Level, to: Level): number => to.elevation - from.elevation;

/**
 * Lays out a stair: counts risers (target ~0.18 m so every riser lands in 0.17–0.19 m for normal heights),
 * picks the tread depth (≥ 0.25 m) and builds every step polygon. Pure geometry in stair-local coordinates:
 * x = direction of ascent, y = across the stair; origin = bottom-center of the first step
 * (centre of the column for spiral stairs).
 */
export function layoutStair(stair: Stair, from: Level, to: Level): StairLayout {
  const warnings: string[] = [];
  const rise = stairRise(from, to);
  const wantRiser = stair.riserHeight ?? TARGET_RISER;
  const riserCount = Math.max(2, Math.round(rise / wantRiser));
  const riser = rise / riserCount;
  if (riser > 0.19 + 1e-6 || riser < 0.17 - 1e-6) {
    warnings.push(
      `Riser height is ${(riser * 100).toFixed(1)} cm — comfortable stairs are 17–19 cm.`,
    );
  }
  let tread = stair.treadDepth ?? DEFAULT_TREAD;
  if (tread < MIN_TREAD) {
    warnings.push(`Tread depth raised to ${MIN_TREAD * 100} cm (minimum).`);
    tread = MIN_TREAD;
  }
  const w = stair.width;
  const treads = riserCount - 1; // the last riser meets the upper floor
  const steps: Step[] = [];
  const runs: Run[] = [];
  const top = (i: number) => (i + 1) * riser;

  if (stair.type === 'straight') {
    const pts: Run['points'] = [];
    for (let i = 0; i < treads; i++) {
      steps.push({ poly: rect(i * tread, (i + 1) * tread, -w / 2, w / 2), top: top(i), bottom: 0 });
      pts.push({ p: { x: i * tread + tread / 2, y: 0 }, top: top(i) });
    }
    runs.push({ points: pts, lateral: { x: 0, y: 1 }, width: w });
  } else if (stair.type === 'L') {
    const a = Math.floor((treads - 1) / 2);
    const b = treads - 1 - a;
    const r1: Run['points'] = [];
    for (let i = 0; i < a; i++) {
      steps.push({ poly: rect(i * tread, (i + 1) * tread, -w / 2, w / 2), top: top(i), bottom: 0 });
      r1.push({ p: { x: i * tread + tread / 2, y: 0 }, top: top(i) });
    }
    const lx = a * tread;
    steps.push({ poly: rect(lx, lx + w, -w / 2, w / 2), top: top(a), bottom: 0 });
    const r2: Run['points'] = [];
    for (let j = 0; j < b; j++) {
      steps.push({
        poly: rect(lx, lx + w, w / 2 + j * tread, w / 2 + (j + 1) * tread),
        top: top(a + 1 + j),
        bottom: 0,
      });
      r2.push({ p: { x: lx + w / 2, y: w / 2 + j * tread + tread / 2 }, top: top(a + 1 + j) });
    }
    runs.push(
      { points: r1, lateral: { x: 0, y: 1 }, width: w },
      { points: r2, lateral: { x: 1, y: 0 }, width: w },
    );
  } else if (stair.type === 'U') {
    const gap = 0.1;
    const a = Math.floor((treads - 1) / 2);
    const b = treads - 1 - a;
    const r1: Run['points'] = [];
    for (let i = 0; i < a; i++) {
      steps.push({ poly: rect(i * tread, (i + 1) * tread, -w / 2, w / 2), top: top(i), bottom: 0 });
      r1.push({ p: { x: i * tread + tread / 2, y: 0 }, top: top(i) });
    }
    const lx = a * tread;
    steps.push({ poly: rect(lx, lx + w, -w / 2, (3 * w) / 2 + gap), top: top(a), bottom: 0 });
    const yc = w + gap;
    const r2: Run['points'] = [];
    for (let j = 0; j < b; j++) {
      steps.push({
        poly: rect(lx - (j + 1) * tread, lx - j * tread, yc - w / 2, yc + w / 2),
        top: top(a + 1 + j),
        bottom: 0,
      });
      r2.push({ p: { x: lx - j * tread - tread / 2, y: yc }, top: top(a + 1 + j) });
    }
    runs.push(
      { points: r1, lateral: { x: 0, y: 1 }, width: w },
      { points: r2, lateral: { x: 0, y: 1 }, width: w },
    );
  } else {
    // Spiral: wedge treads around a centre column; one step every 22.5°.
    const dTheta = Math.PI / 8;
    const R = Math.max(w, 0.6);
    const r0 = 0.1;
    const outer: Run['points'] = [];
    for (let i = 0; i < treads; i++) {
      const a0 = i * dTheta - dTheta / 2;
      const poly: Vec2[] = [];
      for (let k = 0; k <= 3; k++)
        poly.push({
          x: Math.cos(a0 + (dTheta * k) / 3) * R,
          y: Math.sin(a0 + (dTheta * k) / 3) * R,
        });
      for (let k = 3; k >= 0; k--)
        poly.push({
          x: Math.cos(a0 + (dTheta * k) / 3) * r0,
          y: Math.sin(a0 + (dTheta * k) / 3) * r0,
        });
      steps.push({ poly, top: top(i), bottom: Math.max(0, top(i) - 0.05) });
      outer.push({
        p: { x: Math.cos(i * dTheta) * (R - 0.04), y: Math.sin(i * dTheta) * (R - 0.04) },
        top: top(i),
      });
    }
    runs.push({ points: outer, lateral: { x: 0, y: 0 }, width: R });
  }

  // Upper-slab opening: from the first step whose headroom under the slab is < 2 m.
  const slabBottom = rise - to.slabThickness;
  let voidFromStep = steps.findIndex((s) => slabBottom - s.top < MIN_HEADROOM - 1e-6);
  if (voidFromStep < 0) voidFromStep = steps.length;
  if (slabBottom - riser < MIN_HEADROOM) {
    warnings.push(
      `Headroom is under ${MIN_HEADROOM} m — the ceiling height between levels is too low for this stair.`,
    );
  }
  const voidSteps = steps.slice(voidFromStep);
  const voidPolys = voidSteps.map((s) => (stair.type === 'spiral' ? s.poly : expand(s.poly, 0.03)));
  const footprint = steps.map((s) => s.poly);

  return {
    steps,
    runs,
    rise,
    riserCount,
    riser,
    tread,
    width: w,
    voidFromStep,
    warnings,
    voidPolys,
    footprint,
    spiralCenterRadius: stair.type === 'spiral' ? Math.max(w, 0.6) : undefined,
  };
}

const toPlan = (stair: Stair, p: Vec2): Vec2 => add(stair.position, rotate(p, stair.rotation));

/** Stair footprint polygons in plan coordinates. */
export const stairFootprintPlan = (stair: Stair, layout: StairLayout): Vec2[][] =>
  layout.footprint.map((poly) => poly.map((p) => toPlan(stair, p)));

/** Polygons the upper slab must open up for this stair, in plan coordinates. */
export const stairVoidPlan = (stair: Stair, layout: StairLayout): Vec2[][] =>
  layout.voidPolys.map((poly) => poly.map((p) => toPlan(stair, p)));

export interface StairIssue {
  stairId: string;
  messages: string[];
}

/** Checks the stair fits inside the apartment and reports comfort/headroom problems. */
export function validateStair(project: Project, stair: Stair): string[] {
  const from = project.levels.find((l) => l.id === stair.fromLevelId);
  const to = project.levels.find((l) => l.id === stair.toLevelId);
  if (!from || !to) return ['Stair refers to a level that no longer exists.'];
  const layout = layoutStair(stair, from, to);
  const warnings = [...layout.warnings];
  if (Math.abs(from.index - to.index) !== 1) warnings.push('This stair skips a level.');
  const outside = stairFootprintPlan(stair, layout)
    .flat()
    .some((p) => !pointInPolygon(p, project.shell.footprint, 0.02));
  if (outside) warnings.push('The stair does not fit inside the apartment outline.');
  return warnings;
}

/**
 * Builds the stair meshes (treads/blocks, spiral column, railings) in level-local coordinates
 * of the lower level.
 */
export function generateStair(stair: Stair, from: Level, to: Level): Part[] {
  const layout = layoutStair(stair, from, to);
  const geos: BufferGeometry[] = [];
  for (const s of layout.steps) {
    const g = new ExtrudeGeometry(shapeFromPolygon([toRing(s.poly)]), {
      depth: s.top - s.bottom,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, s.bottom, 0);
    geos.push(g);
  }
  const rails: BufferGeometry[] = [];
  if (stair.type === 'spiral') {
    const colH = layout.rise - layout.riser;
    const col = new CylinderGeometry(0.07, 0.07, colH, 16);
    col.translate(0, colH / 2, 0);
    geos.push(col);
  }
  if (stair.railing) {
    for (const run of layout.runs) {
      const sides = stair.type === 'spiral' ? [0] : [-1, 1];
      for (const side of sides) {
        const pts = run.points.map(({ p, top }) => ({
          x: p.x + run.lateral.x * side * (run.width / 2 - 0.03),
          y: p.y + run.lateral.y * side * (run.width / 2 - 0.03),
          z: top + HANDRAIL_HEIGHT,
          floor: top,
        }));
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]!;
          if (i % 2 === 0 || i === pts.length - 1) {
            const post = new BoxGeometry(0.04, p.z - p.floor, 0.04);
            post.translate(p.x, p.floor + (p.z - p.floor) / 2, p.y);
            rails.push(post);
          }
          const n = pts[i + 1];
          if (n) rails.push(segmentBox(p, n, 0.05));
        }
      }
    }
  }
  const out: Part[] = [];
  const entity = { type: 'stair' as const, id: stair.id };
  const place = (g: BufferGeometry) => {
    g.rotateY(-stair.rotation);
    g.translate(stair.position.x, 0, stair.position.y);
    return g;
  };
  const body = mergeAll(geos);
  if (body)
    out.push({
      id: `stair:${stair.id}`,
      layer: 'stair',
      entity,
      geometry: place(body),
      materials: ['stair'],
    });
  const railGeo = mergeAll(rails);
  if (railGeo)
    out.push({
      id: `stair-rail:${stair.id}`,
      layer: 'stair',
      entity,
      geometry: place(railGeo),
      materials: ['rail'],
    });
  return out;
}

/** Thin box from point a to point b (x = local x, y = local lateral → Z, z = height → Y). */
function segmentBox(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  thick: number,
): BufferGeometry {
  const dx = b.x - a.x;
  const dy = b.z - a.z;
  const dz = b.y - a.y;
  const len = Math.hypot(dx, dy, dz);
  const g = new BoxGeometry(len, thick, thick);
  // Orient the box's X axis along (dx, dy, dz).
  const yaw = Math.atan2(-dz, dx);
  const pitch = Math.asin(dy / (len || 1));
  g.rotateZ(pitch);
  g.rotateY(yaw);
  g.translate((a.x + b.x) / 2, (a.z + b.z) / 2, (a.y + b.y) / 2);
  return g;
}
