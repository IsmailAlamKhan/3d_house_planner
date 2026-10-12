import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import * as ops from '../model/ops';
import { getEntry } from './index';
import { clearanceWarnings, nearestWall, placeItem, placeOnWall, snapAngle } from './placement';

const sample = createSampleProject();
const L0 = sample.levels[0]!.id;
const entry = (id: string) => getEntry(id)!;

describe('placeOnWall (doors & windows)', () => {
  it('snaps onto the nearest wall and reports distances to the corners', () => {
    // North exterior wall runs along y = 0; drop a window near x = 5 but 0.4 m inside the room.
    const r = placeOnWall(sample, L0, entry('window-casement'), { x: 5, y: 0.4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const north = sample.walls.find(
      (w) => w.levelId === L0 && w.start.x === 0 && w.start.y === 0 && w.end.x === 10,
    )!;
    expect(r.wallId).toBe(north.id);
    expect(r.offset).toBeCloseTo(5, 1);
    expect(r.distStart + r.distEnd + r.width).toBeCloseTo(10);
    expect(r.sillHeight).toBeCloseTo(0.9);
  });

  it('refuses a drop away from any wall', () => {
    const r = placeOnWall(sample, L0, entry('door-single'), { x: 3, y: 3.5 }); // middle of the living room
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/wall/i);
  });

  it('keeps the opening clear of the wall ends', () => {
    const r = placeOnWall(sample, L0, entry('door-single'), { x: 0.05, y: 0.1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.distStart).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('refuses openings wider than the wall', () => {
    const p = produce(sample, (d) => {
      ops.addWall(d, { levelId: L0, start: { x: 1, y: 3 }, end: { x: 1.8, y: 3 } });
    });
    const short = p.walls.at(-1)!;
    const r = placeOnWall(p, L0, entry('door-double'), { x: 1.4, y: 3 }, { wallId: short.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/too short/i);
  });

  it('refuses openings taller than the wall', () => {
    const r = placeOnWall(sample, L0, entry('window-full'), { x: 5, y: 0 }, { height: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/high/);
  });

  it('nudges next to a neighbour or refuses when the spot is taken', () => {
    // The entrance door is at y = 9.5 on the east wall; drop a window right on it.
    const east = sample.walls.find(
      (w) => w.levelId === L0 && w.start.x === 10 && w.end.x === 10 && w.end.y === 12,
    )!;
    const onTop = placeOnWall(
      sample,
      L0,
      entry('window-casement'),
      { x: 10, y: 9.4 },
      { wallId: east.id },
    );
    expect(onTop.ok).toBe(true); // can shift next to the door
    if (onTop.ok) {
      expect(onTop.nudged).toBe(true);
      expect(Math.abs(onTop.offset - 9.5)).toBeGreaterThanOrEqual(0.5 + 0.6 - 1e-6); // clear of the door
    }
    const crowded = produce(sample, (d) => {
      ops.addOpening(d, {
        wallId: east.id,
        offset: 4,
        width: 6,
        kind: 'window',
        catalogId: 'window-fixed',
      });
    });
    const r = placeOnWall(crowded, L0, entry('door-single'), { x: 10, y: 4 }, { wallId: east.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/taken|free space/);
  });

  it('can move an existing opening (ignores itself)', () => {
    const door = sample.openings.find((o) => o.catalogId === 'door-entrance')!;
    const r = placeOnWall(
      sample,
      L0,
      entry('door-entrance'),
      { x: 10, y: 9.6 },
      { excludeOpeningId: door.id, width: door.width, height: door.height, sillHeight: 0 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nudged).toBe(false);
  });

  it('finds the nearest wall', () => {
    expect(nearestWall(sample, L0, { x: 5, y: 0.2 }, 0.9)).not.toBeNull();
    expect(nearestWall(sample, L0, { x: 3, y: 3.5 }, 0.9)).toBeNull();
  });
});

describe('placeItem', () => {
  it('snaps rotation to 15° steps', () => {
    expect(snapAngle((20 * Math.PI) / 180)).toBeCloseTo((15 * Math.PI) / 180);
    const r = placeItem(
      sample,
      L0,
      entry('coffee-table'),
      { x: 3, y: 3.5 },
      { rotation: (38 * Math.PI) / 180 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rotation).toBeCloseTo((45 * Math.PI) / 180);
  });

  it('snaps back-to-wall with the item facing into the room', () => {
    // Wardrobe 0.6 deep dropped just in front of the north wall (y=0, 0.3 thick).
    const r = placeItem(sample, L0, entry('wardrobe'), { x: 4, y: 0.7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snappedToWall).toBe(true);
    expect(r.rotation).toBeCloseTo(0); // front faces +y (into the room)
    expect(r.position.y).toBeCloseTo(0.15 + 0.3 + 0.002); // wall face + half depth
    // Against the south wall it faces the other way.
    const s = placeItem(sample, L0, entry('wardrobe'), { x: 5, y: 11.3 });
    expect(s.ok).toBe(true);
    if (s.ok) expect(Math.abs(Math.abs(s.rotation) - Math.PI)).toBeLessThan(1e-6);
  });

  it('free-standing pieces do not snap to walls, and snapping can be turned off', () => {
    const r = placeItem(sample, L0, entry('coffee-table'), { x: 1, y: 0.6 });
    expect(r.ok && r.snappedToWall).toBe(false);
    const w = placeItem(sample, L0, entry('wardrobe'), { x: 4, y: 0.7 }, { snapWalls: false });
    expect(w.ok && w.snappedToWall).toBe(false);
  });

  it('wall-mounted items must be on a wall, and hang at their mount height', () => {
    const away = placeItem(sample, L0, entry('mirror'), { x: 3, y: 3.5 });
    expect(away.ok).toBe(false);
    const r = placeItem(sample, L0, entry('mirror'), { x: 1, y: 7.8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.elevation).toBeCloseTo(1.1);
      expect(r.snappedToWall).toBe(true);
    }
  });

  it('ceiling lights hang from the ceiling', () => {
    const r = placeItem(sample, L0, entry('pendant-light'), { x: 3, y: 3.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.elevation).toBeCloseTo(2.7 - 0.9);
  });

  it('refuses placements outside the apartment', () => {
    const r = placeItem(sample, L0, entry('sofa-3seat'), { x: 30, y: 3 });
    expect(r.ok).toBe(false);
    const edge = placeItem(sample, L0, entry('sofa-3seat'), { x: 9.9, y: 3 }, { snapWalls: false });
    expect(edge.ok).toBe(false); // would poke through the east wall line
  });

  it('warns (without refusing) when items overlap or hit columns', () => {
    const sofa = sample.items.find((i) => i.catalogId === 'sofa-3seat')!;
    const r = placeItem(sample, L0, entry('armchair'), { x: sofa.position.x, y: sofa.position.y });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/Overlaps sofa/i);
    const col = placeItem(sample, L0, entry('armchair'), { x: 3, y: 3.5 });
    expect(col.ok && col.warnings.join(' ')).toMatch(/column/);
    const clear = placeItem(sample, L0, entry('armchair'), { x: 1.5, y: 3 }, { snapWalls: false });
    expect(clear.ok && clear.warnings).toEqual([]);
  });

  it('rugs never trigger clearance warnings', () => {
    const w = clearanceWarnings(sample, L0, { w: 2, d: 1.4, h: 0.015 }, { x: 3, y: 5.5 }, 0, 0);
    expect(w).toEqual([]);
  });
});
