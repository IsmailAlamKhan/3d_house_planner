import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonCentroid } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import { createSampleProject } from '../../model/sample';
import {
  type Walker,
  advanceWalker,
  buildWalkWorld,
  forward,
  levelIndexAt,
  moveWalker,
  nearestStandable,
  spawnWalker,
} from './walk';

const project = createSampleProject();
const world = buildWalkWorld(project);

const segCross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

describe('walkthrough physics', () => {
  it('spawns just inside the entrance on the ground level, facing in', () => {
    const w = spawnWalker(project, world);
    expect(levelIndexAt(world, w)).toBe(0);
    expect(pointInPolygon({ x: w.x, y: w.y }, project.shell.footprint)).toBe(true);
    const f = forward(w.yaw);
    // The entrance is on the east wall, so "in" is toward −x.
    expect(f.x).toBeLessThan(-0.9);
  });

  it('is stopped by an exterior wall', () => {
    let w = spawnWalker(project, world);
    for (let i = 0; i < 100; i++)
      w = advanceWalker(world, w, { forward: -1, strafe: 0, turn: 0, run: false }, 0.1);
    // Backing out of the door side: stays inside the footprint.
    expect(pointInPolygon({ x: w.x, y: w.y }, project.shell.footprint)).toBe(true);
    for (let i = 0; i < 200; i++)
      w = advanceWalker(world, w, { forward: 1, strafe: 0, turn: 0, run: true }, 0.1);
    expect(pointInPolygon({ x: w.x, y: w.y }, project.shell.footprint)).toBe(true);
    expect(w.x).toBeGreaterThan(0);
  });

  it('turning changes the heading without moving', () => {
    const w = spawnWalker(project, world);
    const t = advanceWalker(world, w, { forward: 0, strafe: 0, turn: 1, run: false }, 0.5);
    expect(t.yaw).not.toBeCloseTo(w.yaw);
    expect([t.x, t.y]).toEqual([w.x, w.y]);
  });

  it('can walk from the entrance, up the stairs and into an upstairs bedroom without crossing a wall', () => {
    const start = spawnWalker(project, world);
    const bedroom = project.rooms.find(
      (r) => r.type === 'bedroom' && r.levelId === project.levels[1]!.id,
    )!;
    const goal = polygonCentroid(bedroom.polygon);
    const upper = project.levels[1]!;

    const cell = 0.12;
    const key = (w: Walker) =>
      `${Math.round(w.x / cell)},${Math.round(w.y / cell)},${Math.round(w.floor * 20)}`;
    const prev = new Map<string, { from: Walker; to: Walker }>();
    const queue: Walker[] = [start];
    const seen = new Set([key(start)]);
    let found: Walker | null = null;
    const dirs: [number, number][] = [
      [cell, 0],
      [-cell, 0],
      [0, cell],
      [0, -cell],
      [cell, cell],
      [-cell, -cell],
      [cell, -cell],
      [-cell, cell],
    ];
    while (queue.length && !found) {
      const cur = queue.shift()!;
      if (
        cur.floor >= upper.elevation - 0.01 &&
        pointInPolygon({ x: cur.x, y: cur.y }, bedroom.polygon) &&
        Math.hypot(cur.x - goal.x, cur.y - goal.y) < 0.6
      ) {
        found = cur;
        break;
      }
      for (const [dx, dy] of dirs) {
        const n = moveWalker(world, cur, dx, dy);
        if (n.x === cur.x && n.y === cur.y && n.floor === cur.floor) continue;
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, { from: cur, to: n });
        queue.push(n);
      }
    }
    expect(found).not.toBeNull();
    expect(levelIndexAt(world, found!)).toBe(1);

    // Rebuild the path and verify no step crosses a wall centre line of the level it was on.
    const path: Walker[] = [];
    for (let k = key(found!); ;) {
      const e = prev.get(k);
      if (!e) break;
      path.unshift(e.to);
      k = key(e.from);
    }
    path.unshift(start);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      for (const level of world.levels) {
        if (
          Math.min(a.floor, b.floor) + 1 < level.elevation ||
          Math.max(a.floor, b.floor) > level.elevation + level.floorToCeiling
        )
          continue;
        for (const s of world.solids.get(level.id) ?? []) {
          if (s.a.x === s.b.x && s.a.y === s.b.y) continue;
          expect(segCross({ x: a.x, y: a.y }, { x: b.x, y: b.y }, s.a, s.b)).toBe(false);
        }
      }
    }
  });

  it('minimap teleport lands on a standable spot on the chosen level', () => {
    const upper = project.levels[1]!;
    const bedroom = project.rooms.find((r) => r.type === 'bedroom' && r.levelId === upper.id)!;
    const w = nearestStandable(world, upper, polygonCentroid(bedroom.polygon));
    expect(w).not.toBeNull();
    expect(w!.floor).toBeCloseTo(upper.elevation);
    // Inside a wall → nudged out or refused.
    const wall = project.walls.find((x) => x.levelId === upper.id)!;
    const onWall = nearestStandable(world, upper, wall.start, 0.05);
    expect(
      onWall === null || Math.hypot(onWall.x - wall.start.x, onWall.y - wall.start.y) <= 0.05,
    ).toBe(true);
  });
});
