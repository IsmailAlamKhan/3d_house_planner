import { describe, expect, it } from 'vitest';
import { polygonArea } from './polygon';
import { detectRoomPolygons, matchRooms, polygonIoU } from './rooms';

const seg = (sx: number, sy: number, ex: number, ey: number) => ({
  start: { x: sx, y: sy },
  end: { x: ex, y: ey },
});
const loop = (pts: [number, number][]) =>
  pts.map((p, i) => seg(...p, ...pts[(i + 1) % pts.length]!));

describe('detectRoomPolygons', () => {
  it('finds one room in a 4-wall rectangle with the correct area', () => {
    const rooms = detectRoomPolygons(
      loop([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
    );
    expect(rooms).toHaveLength(1);
    expect(polygonArea(rooms[0]!)).toBeCloseTo(12);
    expect(rooms[0]!).toHaveLength(4);
  });

  it('finds an L-shaped room', () => {
    const rooms = detectRoomPolygons(
      loop([
        [0, 0],
        [6, 0],
        [6, 2],
        [2, 2],
        [2, 5],
        [0, 5],
      ]),
    );
    expect(rooms).toHaveLength(1);
    expect(polygonArea(rooms[0]!)).toBeCloseTo(6 * 2 + 2 * 3);
    expect(rooms[0]!).toHaveLength(6);
  });

  it('splits a room with an interior partition (wall ends on the walls, T-junctions)', () => {
    const rooms = detectRoomPolygons([
      ...loop([
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ]),
      seg(2, 0, 2, 4),
    ]);
    expect(
      rooms
        .map((r) => polygonArea(r))
        .sort((a, b) => a - b)
        .map((a) => Math.round(a * 100) / 100),
    ).toEqual([8, 16]);
  });

  it('splits a room when the partition crosses the outer walls', () => {
    const rooms = detectRoomPolygons([
      ...loop([
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ]),
      seg(3, -1, 3, 5),
    ]);
    expect(rooms).toHaveLength(2);
    expect(polygonArea(rooms[0]!)).toBeCloseTo(12);
  });

  it('ignores dangling walls and open shapes', () => {
    expect(detectRoomPolygons([seg(0, 0, 4, 0), seg(4, 0, 4, 3)])).toHaveLength(0);
    const rooms = detectRoomPolygons([
      ...loop([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
      seg(4, 1.5, 6, 1.5),
    ]);
    expect(rooms).toHaveLength(1);
    expect(polygonArea(rooms[0]!)).toBeCloseTo(12);
  });

  it('handles duplicated and split collinear walls', () => {
    const rooms = detectRoomPolygons([
      ...loop([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
      seg(0, 0, 2, 0),
      seg(1, 0, 4, 0),
    ]);
    expect(rooms).toHaveLength(1);
    expect(polygonArea(rooms[0]!)).toBeCloseTo(12);
  });

  it('finds two rooms sharing a wall', () => {
    const rooms = detectRoomPolygons([
      ...loop([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
      ...loop([
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ]),
    ]);
    expect(rooms).toHaveLength(2);
  });
});

describe('matchRooms', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  it('computes IoU', () => {
    expect(polygonIoU(sq(0, 0, 4, 4), sq(0, 0, 4, 4))).toBeCloseTo(1);
    expect(polygonIoU(sq(0, 0, 4, 4), sq(10, 10, 12, 12))).toBe(0);
  });
  it('keeps the existing room for the larger half after a split and creates one for the rest', () => {
    const m = matchRooms([{ id: 'r1', polygon: sq(0, 0, 6, 4) }], [sq(0, 0, 4, 4), sq(4, 0, 6, 4)]);
    expect(m.matches.get(0)).toBe('r1');
    expect(m.unmatchedDetected).toEqual([1]);
  });
  it('survives a small reshape', () => {
    const m = matchRooms([{ id: 'r1', polygon: sq(0, 0, 4, 3) }], [sq(0, 0, 4.4, 3)]);
    expect(m.matches.get(0)).toBe('r1');
  });
  it('reports existing rooms with no match', () => {
    const m = matchRooms([{ id: 'r1', polygon: sq(0, 0, 4, 3) }], []);
    expect(m.unmatchedExisting).toEqual(['r1']);
  });
});
