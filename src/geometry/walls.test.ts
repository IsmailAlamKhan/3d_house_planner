import { describe, expect, it } from 'vitest';
import { polygonArea } from './polygon';
import { computeWallPolygons } from './walls';

const w = (id: string, sx: number, sy: number, ex: number, ey: number, t = 0.2) => ({
  id,
  start: { x: sx, y: sy },
  end: { x: ex, y: ey },
  thickness: t,
});

describe('computeWallPolygons', () => {
  it('single wall is a plain rectangle', () => {
    const p = computeWallPolygons([w('a', 0, 0, 4, 0)]).get('a')!;
    expect(polygonArea(p)).toBeCloseTo(0.8);
  });

  it('mitres an L corner so the outer corner is filled and the inner corner is clean', () => {
    const polys = computeWallPolygons([w('a', 0, 0, 4, 0), w('b', 4, 0, 4, 3)]);
    const a = polys.get('a')!;
    const b = polys.get('b')!;
    // Outer corner (4.1, -0.1) belongs to both outlines; inner corner (3.9, 0.1) too.
    const has = (poly: { x: number; y: number }[], x: number, y: number) =>
      poly.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
    expect(has(a, 4.1, -0.1) && has(b, 4.1, -0.1)).toBe(true);
    expect(has(a, 3.9, 0.1) && has(b, 3.9, 0.1)).toBe(true);
    // Total area = centerline area + corner square adjustments (no gaps/overlap beyond the shared edge).
    expect(polygonArea(a) + polygonArea(b)).toBeCloseTo(4.2 * 0.2 + 2.8 * 0.2 + 0, 5);
  });

  it('butt joins leave square ends', () => {
    const a = computeWallPolygons([w('a', 0, 0, 4, 0), w('b', 4, 0, 4, 3)], { join: 'butt' }).get(
      'a',
    )!;
    expect(polygonArea(a)).toBeCloseTo(0.8);
  });

  it('keeps a collinear continuation seamless', () => {
    const polys = computeWallPolygons([w('a', 0, 0, 2, 0), w('b', 2, 0, 5, 0)]);
    expect(polygonArea(polys.get('a')!)).toBeCloseTo(0.4);
    expect(polygonArea(polys.get('b')!)).toBeCloseTo(0.6);
  });

  it('falls back to a butt join on very sharp angles', () => {
    const polys = computeWallPolygons([w('a', 0, 0, 4, 0), w('b', 0, 0, 4, 0.05)]);
    for (const poly of polys.values()) {
      for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeLessThan(10);
    }
  });

  it('handles a T-junction of three walls at one node', () => {
    const polys = computeWallPolygons([
      w('a', 0, 0, 3, 0),
      w('b', 0, 0, -3, 0),
      w('c', 0, 0, 0, 3),
    ]);
    expect(polys.size).toBe(3);
    expect(polygonArea(polys.get('c')!)).toBeGreaterThan(0.5);
  });
});
