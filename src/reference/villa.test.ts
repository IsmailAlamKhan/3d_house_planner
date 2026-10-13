import { describe, expect, it } from 'vitest';
import { runChecks } from '../checks';
import { applyHomography, rectifyFromCorners } from '../geometry/homography';
import * as ops from '../model/ops';
import { ProjectSchema } from '../model/schemas';
import { buildProject } from './build';
import { fidelityMarkdown, sizeOf } from './fidelity';
import specText from '../../reference/villa.spec.json?raw';
import { parseReferenceSpec, polygonOf } from './spec';

/** The committed Reference Villa: both options, built from a clean state, judged against the picture. */
const raw = JSON.parse(specText) as unknown;
const spec = parseReferenceSpec(raw);
const result = buildProject(raw, { id: 'ref-villa' });
const [A, B] = spec.designs;

describe('Reference Villa spec', () => {
  it('is one project with two design options, built exactly', () => {
    expect(spec.name).toBe('Reference Villa');
    expect(spec.designs.map((d) => `${d.letter}: ${d.name}`)).toEqual([
      'A: As labelled',
      'B: As pictured',
    ]);
    expect(result.project.currentOption.letter).toBe('A');
    expect(result.project.options.map((o) => o.letter)).toEqual(['B']);
    expect(ProjectSchema.safeParse(JSON.parse(JSON.stringify(result.project))).success).toBe(true);
    for (const d of result.report.designs) {
      expect(d.overlaps).toEqual([]);
      expect(d.gaps).toEqual([]);
      expect(d.unreachable).toEqual([]);
      expect(d.warnings).toEqual([]);
    }
  });

  it('has the five saved views and the picture it was traced from', () => {
    expect(result.project.views.map((v) => v.name)).toEqual([
      'Reference top-down',
      'Front gate',
      'Living room',
      'Pool deck',
      'Master bedroom',
    ]);
    expect(result.project.underlays).toHaveLength(1);
    expect(result.project.underlays[0]!.source).toEqual({
      kind: 'url',
      url: 'reference/villa-reference.png',
    });
  });

  it('Option A: every labelled room and area is exactly its label (within an inch)', () => {
    let n = 0;
    for (const s of [...A!.rooms, ...A!.zones]) {
      if (!s.labelSize) continue;
      n++;
      const [w, d] = sizeOf(s);
      const [lw, ld] = s.labelSize;
      const off = Math.min(
        Math.max(Math.abs(w - lw), Math.abs(d - ld)),
        Math.max(Math.abs(w - ld), Math.abs(d - lw)),
      );
      expect(off, `${s.name}: ${w}×${d} against ${lw}×${ld}`).toBeLessThanOrEqual(1 / 12 + 1e-9);
    }
    expect(n).toBeGreaterThanOrEqual(23);
    expect(fidelityMarkdown(spec, result)).toContain('labelled sizes within 1 inch: 23 of 23');
  });

  it('Option B: the plan lines up with the straightened picture, wall for wall, within half a foot', () => {
    const u = spec.underlay!;
    const h = rectifyFromCorners(
      u.corners.map(([x, y]) => ({ x, y })),
      u.size[0],
      u.size[1],
      { x: u.origin[0], y: u.origin[1] },
    )!;
    const at = (x: number, y: number): [number, number] => {
      const p = applyHomography(h, { x, y });
      return [p.x, p.y];
    };
    let checked = 0;
    let worst = 0;
    for (const s of [...B!.rooms, ...B!.zones]) {
      if (!s.pic || !s.rect) continue;
      const [x0, y0, x1, y1] = s.pic;
      const tl = at(x0, y0);
      const tr = at(x1, y0);
      const br = at(x1, y1);
      const bl = at(x0, y1);
      const want = [
        (tl[0] + bl[0]) / 2,
        (tl[1] + tr[1]) / 2,
        (tr[0] + br[0]) / 2,
        (bl[1] + br[1]) / 2,
      ];
      const [rx, ry, rw, rd] = s.rect;
      const have = [rx, ry, rx + rw, ry + rd];
      // the entrance path and the driveway are drawn on to the gate (the plot's front edge), past the picture's box
      const skipBottom = 'type' in s && s.type === 'path' && ry + rd > spec.plot[2]![1] - 1;
      const dev = Math.max(
        ...have.map((v, i) => (skipBottom && i === 3 ? 0 : Math.abs(v - want[i]!))),
      );
      worst = Math.max(worst, dev);
      expect(dev, `${s.name} is ${dev.toFixed(2)} ft from the picture`).toBeLessThanOrEqual(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(25);
    expect(worst).toBeLessThanOrEqual(0.5);
    // and the calibration the brief asks for: the covered parking is 20 ft wide
    const park = B!.zones.find((z) => z.id === 'parking')!;
    expect(sizeOf(park)[0]).toBeCloseTo(20, 0);
  });

  it('both options carry the same inventory, and every item is a known catalogue piece', () => {
    const tags = (d: NonNullable<typeof A>) =>
      new Set(
        [
          ...d.items.map((i) => i.inventory),
          ...d.lines.map((l) => l.inventory),
          ...d.openings.map((o) => o.inventory),
          ...d.gates.map((g) => g.inventory),
          ...d.stairs.map((s) => s.inventory),
        ].filter(Boolean),
      );
    expect([...tags(A!)].sort()).toEqual([...tags(B!)].sort());
    expect(tags(A!).size).toBeGreaterThan(100);
    // the elements the brief names
    for (const name of [
      'Waterfall wall feature',
      'Planted island in the pool',
      'Fire-pit deck',
      'Two sun loungers on the deck',
      'Trampoline',
      'Play tower with slide',
      'Floor medallion in the foyer',
      'Neon strip lights',
      '8-seat dining table',
      'U-shaped sectional sofa',
      'TV wall',
      'Curved garden sofa',
      'Square fountain',
      'White SUV',
      'Black SUV',
      'Sliding gate of the car port',
      'Lit wall pillars',
      'Perimeter hedges',
      'Garden door in the back wall',
      'Pedestrian gate (main entrance)',
      'Vehicle gate (car entrance)',
      'Staircase to the roof terrace',
      'Pergola over the garden lounge',
    ])
      expect(tags(A!), name).toContain(name);
    for (const d of [A!, B!])
      expect(result.report.designs.find((r) => r.id === d.id)!.warnings).toEqual([]);
  });

  it('walks from the pedestrian gate through the foyer to every room, the pool deck, the gym and the roof terrace', () => {
    for (const meta of ops.allDesigns(result.project)) {
      const p = ops.projectForDesign(result.project, meta.id) ?? result.project;
      const report = result.report.designs.find((d) => `design-${d.id}` === meta.id)!;
      expect(report.walkthrough.unreached, `${meta.letter}`).toEqual([]);
      const names = new Set(report.walkthrough.reached);
      for (const must of ['Foyer', 'Gym', 'Sauna', 'Spa', 'Roof Terrace', 'Kitchen', 'Gaming Room'])
        expect(names, `${meta.letter}: ${must}`).toContain(must);
      expect([...names].some((n) => n.startsWith('Infinity Pool'))).toBe(true);
      expect(names.has('Fire-Pit Deck')).toBe(true);
      // the entrance is the foyer's double door, and nothing stands in the way of any door
      const issues = runChecks(p);
      expect(
        issues.map((i) => `${i.rule}: ${i.message}`),
        `${meta.letter}`,
      ).toEqual([]);
      expect(p.rooms.length).toBe(polygonCount(meta.letter === 'A' ? A! : B!));
    }
  });
});

const polygonCount = (d: NonNullable<typeof A>) =>
  d.rooms.filter((r) => polygonOf(r).length >= 3).length;
