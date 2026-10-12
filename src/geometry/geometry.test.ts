import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, polygonCentroid } from './polygon';
import { boxCorners, overlapDepth, wallRect } from './collide';
import { dist, projectOnSegment, rotate } from './vec';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 2 },
  { x: 0, y: 2 },
];

describe('polygon', () => {
  it('computes area and centroid', () => {
    expect(polygonArea(square)).toBe(8);
    expect(polygonCentroid(square)).toEqual({ x: 2, y: 1 });
  });
  it('tests containment with tolerance', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 1 }, square)).toBe(false);
    expect(pointInPolygon({ x: 4.05, y: 1 }, square, 0.1)).toBe(true);
  });
});

describe('vec', () => {
  it('measures, rotates and projects', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
    expect(projectOnSegment({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 }).distance).toBe(3);
  });
});

describe('collide', () => {
  it('detects overlapping and separate boxes', () => {
    const a = boxCorners({ x: 0, y: 0 }, 2, 1, 0);
    expect(overlapDepth(a, boxCorners({ x: 1.5, y: 0 }, 2, 1, 0))).toBeCloseTo(0.5);
    expect(overlapDepth(a, boxCorners({ x: 3, y: 0 }, 2, 1, 0))).toBe(0);
    expect(overlapDepth(a, boxCorners({ x: 2, y: 0 }, 2, 1, 0))).toBe(0); // touching
    expect(overlapDepth(a, boxCorners({ x: 0.4, y: 0.4 }, 1, 1, Math.PI / 4))).toBeGreaterThan(0.1);
  });
  it('builds wall rectangles with thickness', () => {
    const r = wallRect({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.2);
    expect(overlapDepth(r, boxCorners({ x: 2, y: 0.15 }, 1, 0.2, 0))).toBeCloseTo(0.05);
  });
});
