import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/project';
import { produce } from 'immer';
import * as ops from '../model/ops';
import { boxSelect, hitTest } from './hit';
import { computeEndpointMove, computeWallMove, wallsOnRoomOutline } from './moves';
import { fitBounds, gridSpacing, toScreen, toWorld, zoomAt } from './view';

const w = (id: string, sx: number, sy: number, ex: number, ey: number) =>
  ({
    id,
    levelId: 'L',
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
    thickness: 0.2,
    type: 'interior',
    materialInside: 'a',
    materialOutside: 'a',
    locked: false,
  }) as const;

describe('view', () => {
  it('round-trips screen/world and zooms about the cursor', () => {
    const v = { scale: 50, tx: 10, ty: 20 };
    const p = toWorld(v, 110, 120);
    expect(toScreen(v, p)).toEqual({ x: 110, y: 120 });
    const z = zoomAt(v, 110, 120, 2);
    expect(toWorld(z, 110, 120)).toEqual(p);
  });
  it('fits bounds and adapts the grid', () => {
    const v = fitBounds({ x: 0, y: 0 }, { x: 10, y: 10 }, { w: 500, h: 500 }, 50);
    expect(v.scale).toBeCloseTo(40);
    expect(gridSpacing(100).minor).toBe(0.25);
    expect(gridSpacing(10).minor).toBe(2);
    expect(gridSpacing(10).major).toBe(8);
  });
});

describe('hit testing', () => {
  const walls = [w('a', 0, 0, 4, 0), w('b', 4, 0, 4, 3)];
  const scene = {
    walls: [...walls],
    rooms: [],
    columns: [],
    selection: { type: null, ids: [] },
    px: 0.02,
  };
  it('hits walls near the centerline only', () => {
    expect(hitTest({ x: 2, y: 0.05 }, scene)).toEqual({ type: 'wall', id: 'a' });
    expect(hitTest({ x: 2, y: 1 }, scene)).toBeNull();
  });
  it('offers endpoint handles for selected walls', () => {
    const h = hitTest({ x: 0.05, y: 0 }, { ...scene, selection: { type: 'wall', ids: ['a'] } });
    expect(h).toEqual({ type: 'handle', wallId: 'a', end: 'start' });
  });
  it('box-selects walls', () => {
    const sel = boxSelect({ x: 3, y: -1 }, { x: 5, y: 4 }, scene);
    expect(sel.type).toBe('wall');
    expect(sel.ids).toEqual(['a', 'b']);
  });
});

describe('hit testing furniture, doors and the rotate handle', () => {
  const scene = {
    walls: [w('a', 0, 0, 4, 0)],
    rooms: [],
    columns: [],
    items: [
      { id: 'big', position: { x: 2, y: 2 }, rotation: 0, w: 2, d: 1 },
      { id: 'small', position: { x: 2, y: 2 }, rotation: 0, w: 0.5, d: 0.5 },
      { id: 'turned', position: { x: 6, y: 2 }, rotation: Math.PI / 2, w: 2, d: 0.5 },
    ],
    openings: [{ id: 'door', center: { x: 1, y: 0 }, angle: 0, width: 0.9, thickness: 0.2 }],
    selection: { type: null, ids: [] },
    px: 0.02,
  };
  it('prefers the smaller item where they overlap, and respects rotation', () => {
    expect(hitTest({ x: 2, y: 2 }, scene)).toEqual({ type: 'item', id: 'small' });
    expect(hitTest({ x: 2.8, y: 2 }, scene)).toEqual({ type: 'item', id: 'big' });
    // The rotated item is 2 m tall (plan y) and 0.5 m wide.
    expect(hitTest({ x: 6, y: 2.9 }, scene)).toEqual({ type: 'item', id: 'turned' });
    expect(hitTest({ x: 6.9, y: 2 }, scene)).toBeNull();
  });
  it('hits doors/windows before the wall they are in', () => {
    expect(hitTest({ x: 1, y: 0.05 }, scene)).toEqual({ type: 'opening', id: 'door' });
    expect(hitTest({ x: 3, y: 0.05 }, scene)).toEqual({ type: 'wall', id: 'a' });
  });
  it('offers a rotate handle in front of the selected item', () => {
    const sel = { type: 'item' as const, ids: ['big'] };
    // Item faces +y: the handle sits beyond its front edge (centre y 2 + 0.5 depth + 22 px).
    expect(hitTest({ x: 2, y: 2 + 0.5 + 22 * 0.02 }, { ...scene, selection: sel })).toEqual({
      type: 'rotate',
      itemId: 'big',
    });
    expect(hitTest({ x: 2, y: 2 + 0.5 + 22 * 0.02 }, scene)).toBeNull();
  });
});

describe('moves', () => {
  const walls = [w('a', 0, 0, 4, 0), w('b', 4, 0, 4, 3), w('c', 10, 10, 12, 10)];
  it('moves selected walls and drags connected corners along', () => {
    const r = computeWallMove(walls, ['a'], { x: 0, y: 1 });
    expect(r.find((g) => g.id === 'a')).toMatchObject({
      start: { x: 0, y: 1 },
      end: { x: 4, y: 1 },
    });
    expect(r.find((g) => g.id === 'b')).toMatchObject({
      start: { x: 4, y: 1 },
      end: { x: 4, y: 3 },
    });
    expect(r.find((g) => g.id === 'c')).toBeUndefined();
  });
  it('drags a shared endpoint for all walls on it', () => {
    const r = computeEndpointMove(walls, 'a', 'end', { x: 5, y: 0 });
    expect(r).toHaveLength(2);
    expect(r.find((g) => g.id === 'b')!.start).toEqual({ x: 5, y: 0 });
  });
});

describe('plan operations', () => {
  const base = createEmptyProject();
  const L = base.levels[0]!.id;
  const sq = [
    { x: 1, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ];

  it('drawing a 4-wall rectangle creates one room with the right area', () => {
    const p = produce(base, (d) => {
      ops.addWallChain(d, L, sq, { closed: true });
    });
    expect(p.walls).toHaveLength(4);
    expect(p.rooms).toHaveLength(1);
    expect(p.rooms[0]!.polygon).toHaveLength(4);
  });

  it('splitting a room with a partition gives two rooms and keeps the original name on the bigger one', () => {
    const one = produce(base, (d) => {
      ops.addRoomWithWalls(d, L, sq);
      d.rooms[0]!.name = 'Living';
    });
    const two = produce(one, (d) => {
      ops.addWallChain(d, L, [
        { x: 2, y: 1 },
        { x: 2, y: 4 },
      ]);
    });
    expect(two.rooms).toHaveLength(2);
    expect(two.rooms.some((r) => r.name === 'Living')).toBe(true);
    expect(two.rooms.some((r) => r.name !== 'Living')).toBe(true);
    // Removing the partition merges again.
    const merged = produce(two, (d) => {
      ops.deleteWallsAndSync(d, [d.walls[d.walls.length - 1]!.id]);
    });
    expect(merged.rooms).toHaveLength(1);
  });

  it('does not duplicate walls when a second room shares an edge', () => {
    const p = produce(base, (d) => {
      ops.addRoomWithWalls(d, L, sq);
      ops.addRoomWithWalls(d, L, [
        { x: 5, y: 1 },
        { x: 8, y: 1 },
        { x: 8, y: 4 },
        { x: 5, y: 4 },
      ]);
    });
    expect(p.walls).toHaveLength(7);
    expect(p.rooms).toHaveLength(2);
  });

  it('moving a wall keeps rooms in sync and openings attached', () => {
    const p0 = produce(base, (d) => {
      ops.addRoomWithWalls(d, L, sq);
    });
    const north = p0.walls.find((x) => x.start.y === 1 && x.end.y === 1)!;
    const p1 = produce(p0, (d) => {
      ops.addOpening(d, { wallId: north.id, offset: 2 });
      ops.setWallGeometry(d, computeWallMove(d.walls, [north.id], { x: 0, y: -1 }));
    });
    expect(p1.openings).toHaveLength(1);
    expect(p1.rooms).toHaveLength(1);
    expect(p1.rooms[0]!.polygon.some((q) => q.y === 0)).toBe(true);
  });

  it('deleting a room removes only its own walls', () => {
    const p0 = produce(base, (d) => {
      ops.addRoomWithWalls(d, L, sq);
      ops.addRoomWithWalls(d, L, [
        { x: 5, y: 1 },
        { x: 8, y: 1 },
        { x: 8, y: 4 },
        { x: 5, y: 4 },
      ]);
    });
    const right = p0.rooms.find((r) => r.polygon.some((q) => q.x === 8))!;
    const p1 = produce(p0, (d) => ops.deleteRoomWithWalls(d, right.id));
    expect(p1.walls).toHaveLength(4);
    expect(p1.rooms).toHaveLength(1);
    expect(wallsOnRoomOutline(p1.walls, p1.rooms[0]!)).toHaveLength(4);
  });
});
