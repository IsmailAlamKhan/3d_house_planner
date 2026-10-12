import { pointInPolygon } from '../../geometry/polygon';
import { type Vec2, projectOnSegment } from '../../geometry/vec';
import type { Level, Project } from '../../model/types';
import { layoutStair, stairFootprintPlan } from '../generators/stairs';
import { slabVoids } from '../generators/voids';

/** Eye height above the floor (m). */
export const EYE_HEIGHT = 1.6;
/** Body radius used for collisions (m). */
export const BODY_RADIUS = 0.18;
/** Highest step the walker climbs without a stair (m). */
export const STEP_UP = 0.32;
export const WALK_SPEED = 1.5;
export const RUN_SPEED = 3;
export const TURN_SPEED = 1.8;

/** A thick line the walker cannot cross (a wall piece between door gaps, or a column). */
interface Solid {
  a: Vec2;
  b: Vec2;
  /** Half thickness (m). */
  r: number;
}

interface StairWorld {
  from: Level;
  to: Level;
  /** Plan polygons of the steps with their absolute top heights. */
  steps: { poly: Vec2[]; top: number }[];
}

export interface WalkWorld {
  footprint: Vec2[];
  levels: Level[];
  solids: Map<string, Solid[]>;
  stairs: StairWorld[];
  voids: Map<string, Vec2[][]>;
}

export interface Walker {
  /** Position in the plan (m). */
  x: number;
  y: number;
  /** Absolute height of the floor under the walker (m). */
  floor: number;
  /** Camera heading (radians): rotation about the vertical axis, 0 looks toward −y of the plan. */
  yaw: number;
  /** Look up/down (radians, positive looks up). */
  pitch: number;
}

/** Plan direction of "forward" and "right" for a heading. */
export const forward = (yaw: number): Vec2 => ({ x: -Math.sin(yaw), y: -Math.cos(yaw) });
export const right = (yaw: number): Vec2 => ({ x: Math.cos(yaw), y: -Math.sin(yaw) });

/** Everything the walker can bump into or stand on, derived once per project edit. */
export function buildWalkWorld(project: Project): WalkWorld {
  const solids = new Map<string, Solid[]>();
  const voids = new Map<string, Vec2[][]>();
  const levels = [...project.levels].sort((a, b) => a.index - b.index);
  for (const level of levels) {
    const list: Solid[] = [];
    for (const wall of project.walls.filter((w) => w.levelId === level.id)) {
      const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      if (len < 1e-6) continue;
      // Doors and archways are gaps: split the wall around them.
      const gaps = project.openings
        .filter((o) => o.wallId === wall.id && o.sillHeight < 0.2 && o.height > 1.8)
        .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as const)
        .sort((p, q) => p[0] - q[0]);
      const at = (d: number): Vec2 => ({
        x: wall.start.x + ((wall.end.x - wall.start.x) * d) / len,
        y: wall.start.y + ((wall.end.y - wall.start.y) * d) / len,
      });
      let cursor = 0;
      for (const [g0, g1] of gaps) {
        if (g0 > cursor + 1e-6) list.push({ a: at(cursor), b: at(g0), r: wall.thickness / 2 });
        cursor = Math.max(cursor, g1);
      }
      if (cursor < len - 1e-6) list.push({ a: at(cursor), b: at(len), r: wall.thickness / 2 });
    }
    for (const c of project.columns.filter((k) => k.levelId === level.id)) {
      const half = Math.max(c.size.w, c.size.d) / 2;
      list.push({ a: c.position, b: c.position, r: half });
    }
    solids.set(level.id, list);
    voids.set(level.id, slabVoids(project, level));
  }
  const stairs: StairWorld[] = [];
  for (const stair of project.stairs) {
    const from = project.levels.find((l) => l.id === stair.fromLevelId);
    const to = project.levels.find((l) => l.id === stair.toLevelId);
    if (!from || !to) continue;
    const layout = layoutStair(stair, from, to);
    const polys = stairFootprintPlan(stair, layout);
    // `footprint` has one ring per step (spiral and straight alike).
    const steps = layout.steps.map((s, i) => ({
      poly: polys[i] ?? polys[0]!,
      top: from.elevation + s.top,
    }));
    stairs.push({ from, to, steps });
  }
  return { footprint: project.shell.footprint, levels, solids, stairs, voids };
}

/** Levels whose walls matter at this floor height (the body spans from the floor up to the eyes). */
function activeLevels(world: WalkWorld, floor: number): Level[] {
  return world.levels.filter(
    (l) => floor + EYE_HEIGHT > l.elevation + 0.1 && floor < l.elevation + l.floorToCeiling,
  );
}

/** Pushes a point out of every solid it overlaps (a few passes settle corners). */
function resolve(world: WalkWorld, p: Vec2, floor: number): Vec2 {
  let q = { ...p };
  const solids = activeLevels(world, floor).flatMap((l) => world.solids.get(l.id) ?? []);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const s of solids) {
      const min = s.r + BODY_RADIUS;
      const proj = projectOnSegment(q, s.a, s.b);
      if (proj.distance >= min - 1e-9) continue;
      const dx = q.x - proj.point.x;
      const dy = q.y - proj.point.y;
      const d = Math.hypot(dx, dy);
      let nx = dx / (d || 1);
      let ny = dy / (d || 1);
      if (d < 1e-9) {
        // Exactly on the line: push sideways.
        nx = -(s.b.y - s.a.y) || 1;
        ny = s.b.x - s.a.x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
      }
      q = { x: proj.point.x + nx * min, y: proj.point.y + ny * min };
      moved = true;
    }
    if (!moved) break;
  }
  return q;
}

/** Height of the floor the walker could stand on at p when currently at `floor`, or null if there is none. */
export function floorAt(world: WalkWorld, p: Vec2, floor: number): number | null {
  // Steps first: a step whose top is within reach is the surface to stand on; one that rises well above the feet
  // is solid (you cannot walk through it); one far below the feet is simply underneath.
  let step: number | null = null;
  for (const st of world.stairs)
    for (const s of st.steps) {
      if (!pointInPolygon(p, s.poly, 0.005)) continue;
      if (Math.abs(s.top - floor) <= STEP_UP + 1e-9) {
        if (step === null || Math.abs(s.top - floor) < Math.abs(step - floor)) step = s.top;
      } else if (s.top > floor) return null;
    }
  if (step !== null) return step;
  let best: number | null = null;
  for (const level of world.levels) {
    if (Math.abs(level.elevation - floor) > STEP_UP + 1e-9) continue;
    if (!pointInPolygon(p, world.footprint, 0.02)) continue;
    const holes = world.voids.get(level.id) ?? [];
    if (level.index > 0 && holes.some((h) => pointInPolygon(p, h, -0.001))) continue;
    if (best === null || Math.abs(level.elevation - floor) < Math.abs(best - floor))
      best = level.elevation;
  }
  return best;
}

/** Moves the walker by (dx, dy) in the plan (a small step), sliding along walls; never leaves walkable floor. */
export function moveWalker(world: WalkWorld, w: Walker, dx: number, dy: number): Walker {
  const attempt = (tx: number, ty: number): Walker | null => {
    const p = resolve(world, { x: tx, y: ty }, w.floor);
    const h = floorAt(world, p, w.floor);
    if (h === null) return null;
    // Resolving must not have pushed us back across the wall we were told to stop at.
    return { ...w, x: p.x, y: p.y, floor: h };
  };
  return attempt(w.x + dx, w.y + dy) ?? attempt(w.x + dx, w.y) ?? attempt(w.x, w.y + dy) ?? w;
}

export interface WalkInput {
  /** −1…1: forward / strafe right. */
  forward: number;
  strafe: number;
  /** −1…1: turn left / right with the keyboard. */
  turn: number;
  run: boolean;
}

/** Advances the walker by `dt` seconds of input, in sub-steps small enough that walls can't be skipped. */
export function advanceWalker(world: WalkWorld, w: Walker, input: WalkInput, dt: number): Walker {
  let cur: Walker = { ...w, yaw: w.yaw - input.turn * TURN_SPEED * dt };
  const f = forward(cur.yaw);
  const r = right(cur.yaw);
  let vx = f.x * input.forward + r.x * input.strafe;
  let vy = f.y * input.forward + r.y * input.strafe;
  const mag = Math.hypot(vx, vy);
  if (mag > 1) {
    vx /= mag;
    vy /= mag;
  }
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const total = Math.hypot(vx, vy) * speed * dt;
  if (total < 1e-9) return cur;
  const n = Math.max(1, Math.ceil(total / 0.05));
  for (let i = 0; i < n; i++)
    cur = moveWalker(world, cur, (vx * speed * dt) / n, (vy * speed * dt) / n);
  return cur;
}

/** Where a visitor enters: just inside the entrance door on the ground level, facing in. */
export function spawnWalker(project: Project, world = buildWalkWorld(project)): Walker {
  const ground = world.levels[0];
  const { position, direction } = project.shell.entrance;
  const dirX = Math.cos(direction);
  const dirY = Math.sin(direction);
  const floor = ground?.elevation ?? 0;
  const base = { floor, yaw: Math.atan2(dirX, dirY), pitch: 0 };
  for (const d of [0.9, 1.2, 1.6, 2.2]) {
    const p = resolve(world, { x: position.x - dirX * d, y: position.y - dirY * d }, floor);
    if (floorAt(world, p, floor) !== null) return { ...base, x: p.x, y: p.y };
  }
  const c = world.footprint.reduce(
    (a, q) => ({ x: a.x + q.x / world.footprint.length, y: a.y + q.y / world.footprint.length }),
    { x: 0, y: 0 },
  );
  return { ...base, x: c.x, y: c.y };
}

/** Nearest walkable spot to (x, y) on a level (for minimap clicks), or null if none within `reach` metres. */
export function nearestStandable(
  world: WalkWorld,
  level: Level,
  p: Vec2,
  reach = 1.2,
): Walker | null {
  for (let r = 0; r <= reach + 1e-9; r += 0.15) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r * 16));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const q = resolve(
        world,
        { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r },
        level.elevation,
      );
      // Not pushed away from where we asked more than the reach allows.
      if (Math.hypot(q.x - p.x, q.y - p.y) > reach) continue;
      const h = floorAt(world, q, level.elevation);
      if (h !== null && Math.abs(h - level.elevation) < 1e-6)
        return { x: q.x, y: q.y, floor: h, yaw: 0, pitch: 0 };
    }
  }
  return null;
}

/** Index of the level the walker is standing on (or the nearest one below while on a stair). */
export function levelIndexAt(world: WalkWorld, w: Walker): number {
  let idx = world.levels[0]?.index ?? 0;
  for (const l of world.levels) if (l.elevation <= w.floor + STEP_UP + 1e-9) idx = l.index;
  return idx;
}
