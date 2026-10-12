import { describe, expect, it } from 'vitest';
import { snap, type SnapContext } from './snap';

const base: SnapContext = { enabled: true, gridSize: 0.1, tolerance: 0.15, segments: [] };

describe('snap', () => {
  it('does nothing when disabled', () => {
    expect(snap({ x: 1.234, y: 2.345 }, { ...base, enabled: false })).toEqual({
      point: { x: 1.234, y: 2.345 },
      kind: 'none',
    });
  });
  it('snaps to the grid', () => {
    const r = snap({ x: 1.234, y: 2.351 }, base);
    expect(r.kind).toBe('grid');
    expect(r.point.x).toBeCloseTo(1.2);
    expect(r.point.y).toBeCloseTo(2.4);
  });
  it('prefers endpoints, then midpoints', () => {
    const segs = [{ start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }];
    expect(snap({ x: 3.95, y: 0.05 }, { ...base, segments: segs })).toMatchObject({
      kind: 'endpoint',
      point: { x: 4, y: 0 },
    });
    expect(snap({ x: 2.05, y: 0.05 }, { ...base, segments: segs })).toMatchObject({
      kind: 'midpoint',
      point: { x: 2, y: 0 },
    });
  });
  it('snaps to 0/45/90° from an anchor', () => {
    const r = snap({ x: 3.04, y: 0.1 }, { ...base, anchor: { x: 0, y: 0 } });
    expect(r.kind).toBe('angle');
    expect(r.point.y).toBeCloseTo(0);
    expect(r.point.x).toBeCloseTo(3);
    const d = snap({ x: 2.02, y: 1.97 }, { ...base, anchor: { x: 0, y: 0 } });
    expect(d.kind).toBe('angle');
    expect(d.point.x).toBeCloseTo(d.point.y);
  });
  it('snaps parallel and perpendicular to existing walls', () => {
    const tilted = [{ start: { x: 10, y: 10 }, end: { x: 13, y: 11 } }];
    const a = Math.atan2(1, 3);
    const par = snap(
      { x: Math.cos(a) * 2, y: Math.sin(a) * 2 + 0.03 },
      { ...base, anchor: { x: 0, y: 0 }, segments: tilted },
    );
    expect(par.kind).toBe('parallel');
    const perp = snap(
      { x: -Math.sin(a) * 2 + 0.03, y: Math.cos(a) * 2 },
      { ...base, anchor: { x: 0, y: 0 }, segments: tilted },
    );
    expect(perp.kind).toBe('perpendicular');
  });
});
