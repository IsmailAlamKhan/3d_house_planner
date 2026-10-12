import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../model/sample';
import { defaultSection, sectionCaps, sectionPlanes } from './section';

const project = createSampleProject();
const area = (m: ReturnType<typeof sectionCaps>['horizontal']) =>
  m
    ? m.shapes.reduce(
        (sum, poly) =>
          sum +
          poly.reduce((a, ring, i) => {
            let s = 0;
            for (let k = 0; k < ring.length; k++) {
              const [x1, y1] = ring[k]!;
              const [x2, y2] = ring[(k + 1) % ring.length]!;
              s += x1 * y2 - x2 * y1;
            }
            return a + (i === 0 ? 1 : -1) * Math.abs(s / 2);
          }, 0),
        0,
      )
    : 0;

describe('section planes', () => {
  it('only produces planes for enabled sections', () => {
    expect(sectionPlanes(defaultSection())).toEqual([]);
    const s = defaultSection();
    s.horizontal.on = true;
    s.horizontal.height = 1.5;
    s.vertical.on = true;
    s.vertical.pos = 4;
    const planes = sectionPlanes(s);
    expect(planes).toHaveLength(2);
    // Keeps y ≤ 1.5 and x ≤ 4.
    const keep = (p: (typeof planes)[number], v: [number, number, number]) =>
      p.normal[0] * v[0] + p.normal[1] * v[1] + p.normal[2] * v[2] + p.constant >= 0;
    expect(keep(planes[0]!, [0, 1, 0])).toBe(true);
    expect(keep(planes[0]!, [0, 2, 0])).toBe(false);
    expect(keep(planes[1]!, [3, 0, 0])).toBe(true);
    expect(keep(planes[1]!, [5, 0, 0])).toBe(false);
  });
});

describe('section caps', () => {
  it('a horizontal cut through the walls gives solid wall faces with the doors left open', () => {
    const s = defaultSection();
    s.horizontal = { on: true, height: 1.2 };
    const caps = sectionCaps(project, s);
    const a = area(caps.horizontal);
    expect(a).toBeGreaterThan(2);
    // Cutting above the door lintel no longer removes the door gaps → more solid area.
    s.horizontal.height = 2.4;
    const high = area(sectionCaps(project, s).horizontal);
    expect(high).toBeGreaterThan(a);
  });

  it('a cut inside the slab covers the footprint minus the stair void', () => {
    const s = defaultSection();
    const upper = project.levels[1]!;
    s.horizontal = { on: true, height: upper.elevation - upper.slabThickness / 2 };
    const caps = sectionCaps(project, s);
    const slab = area(caps.horizontal);
    expect(slab).toBeGreaterThan(80);
    expect(slab).toBeLessThan(120);
  });

  it('a vertical cut produces wall and slab rectangles on the plane', () => {
    const s = defaultSection();
    s.vertical = { on: true, axis: 'x', pos: 5, flip: false };
    const caps = sectionCaps(project, s);
    expect(caps.vertical!.rects.length).toBeGreaterThan(4);
    for (const r of caps.vertical!.rects) {
      expect(r.u1).toBeGreaterThan(r.u0);
      expect(r.y1).toBeGreaterThan(r.y0);
    }
    // The plane x = 5 crosses the y = 0 and y = 12 exterior walls: one rect at the top and one at the bottom per level.
    const lows = caps.vertical!.rects.filter((r) => r.u0 < 0.2 && r.y1 - r.y0 > 2);
    expect(lows.length).toBeGreaterThanOrEqual(2);
  });

  it('door gaps are not capped', () => {
    const s = defaultSection();
    // The entrance door is on the east wall (x = 10) at y = 9.5; cutting along y = 9.5 passes through it.
    s.vertical = { on: true, axis: 'z', pos: 9.5, flip: false };
    const wallCaps = sectionCaps(project, s).vertical!.rects.filter(
      (r) => r.u0 > 9.7 && r.u1 < 10.3 && r.y1 <= 2.7,
    );
    // Ground level: nothing below the door height (2.1 m) on the wall; the lintel above it remains.
    expect(wallCaps.filter((r) => r.y0 < 2)).toEqual([]);
    expect(sectionCaps(project, s).vertical!.rects.some((r) => r.u1 > 9.7 && r.y0 >= 2)).toBe(true);
  });
});
