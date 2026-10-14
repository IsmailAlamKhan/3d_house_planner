import { describe, expect, it } from 'vitest';
import { buildProject } from '../../reference/build';
import type { Candidate } from './assemble';
import { cleanup, guessFtPerPx } from './cleanup';
import { toSpec } from './toSpec';

const cand = (
  id: string,
  name: string,
  type: string,
  box: [number, number, number, number],
  label?: [number, number],
  kind: 'room' | 'zone' = 'room',
  confidence = 0.9,
): Candidate => ({
  id,
  name,
  kind,
  type,
  box,
  ...(label ? { labelSize: label } : {}),
  confidence,
  source: 'label+box',
});

/** A little house drawn at 10 px per foot, a few pixels crooked, with the labels the picture would have. */
const house: Candidate[] = [
  cand('a', 'Living', 'living', [100, 100, 300, 300], [20, 20]),
  cand('b', 'Kitchen', 'kitchen', [304, 98, 450, 205], [14, 10]),
  cand('c', 'Bedroom 1', 'bedroom', [302, 210, 452, 330], [15, 12]),
  cand('d', 'Foyer', 'foyer', [100, 306, 200, 380], [10, 7]),
  cand('e', 'Bath', 'bathroom', [205, 308, 298, 380], [9, 7]),
  cand('f', 'Garden', 'lawn', [100, 390, 450, 480], undefined, 'zone'),
];

describe('geometry clean-up', () => {
  it('lines the walls up, closes the small gaps and leaves no overlaps', () => {
    const { rects } = cleanup(house, { ftPerPx: 0.1, fit: 'pictured' });
    const get = (n: string) => rects.find((r) => r.name === n)!.rect;
    const [lx, , lw] = get('Living');
    const [kx] = get('Kitchen');
    expect(kx).toBeCloseTo(lx + lw, 5); // the gap between living and kitchen is closed
    // kitchen and bedroom share one wall line
    expect(get('Kitchen')[0]).toBe(get('Bedroom 1')[0]);
    expect(get('Kitchen')[0] + get('Kitchen')[2]).toBe(get('Bedroom 1')[0] + get('Bedroom 1')[2]);
    for (const a of rects)
      for (const b of rects) {
        if (a === b || a.kind !== 'room' || b.kind !== 'room') continue;
        const ox =
          Math.min(a.rect[0] + a.rect[2], b.rect[0] + b.rect[2]) - Math.max(a.rect[0], b.rect[0]);
        const oy =
          Math.min(a.rect[1] + a.rect[3], b.rect[1] + b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
        expect(ox > 0.05 && oy > 0.05, `${a.name} / ${b.name}`).toBe(false);
      }
  });

  it('fits every room to its label when asked, keeping the layout', () => {
    const { rects } = cleanup(house, { ftPerPx: 0.1, fit: 'labelled' });
    for (const r of rects.filter((x) => x.kind === 'room')) {
      const [, , w, d] = r.rect;
      const [lw, ld] = r.labelSize!;
      expect(Math.max(Math.abs(w - lw), Math.abs(d - ld)), r.name).toBeLessThanOrEqual(0.26);
    }
    // order is kept: the living room is still left of the kitchen
    const living = rects.find((r) => r.name === 'Living')!.rect;
    const kitchen = rects.find((r) => r.name === 'Kitchen')!.rect;
    expect(living[0]).toBeLessThan(kitchen[0]);
    // and the rooms do not overlap one another after fitting
    const rooms = rects.filter((x) => x.kind === 'room');
    for (const a of rooms)
      for (const b of rooms) {
        if (a === b) continue;
        const ox =
          Math.min(a.rect[0] + a.rect[2], b.rect[0] + b.rect[2]) - Math.max(a.rect[0], b.rect[0]);
        const oy =
          Math.min(a.rect[1] + a.rect[3], b.rect[1] + b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
        expect(ox > 0.3 && oy > 0.3, `${a.name} / ${b.name}`).toBe(false);
      }
  });

  it('guesses the scale from the labels when the user gave none', () => {
    expect(guessFtPerPx(house)!).toBeCloseTo(0.1, 1);
    expect(guessFtPerPx([cand('x', 'x', 'x', [0, 0, 10, 10])])).toBeNull();
  });

  it('a zone gives way to a room it overlaps', () => {
    const c = [
      cand('r', 'Gym', 'gym', [0, 0, 100, 100], undefined, 'room'),
      cand('z', 'Lawn', 'lawn', [60, 0, 300, 100], undefined, 'zone'),
    ];
    const { rects } = cleanup(c, { ftPerPx: 0.1, fit: 'pictured' });
    const gym = rects.find((r) => r.name === 'Gym')!.rect;
    const lawn = rects.find((r) => r.name === 'Lawn')!.rect;
    expect(gym[2]).toBe(10); // unchanged
    expect(lawn[0]).toBeGreaterThanOrEqual(gym[0] + gym[2] - 0.01);
  });
});

describe('from rooms to a spec the builder accepts', () => {
  for (const fit of ['labelled', 'pictured'] as const) {
    it(`builds the little house (${fit}): doors, entrance, gate, no overlaps, every room reachable`, () => {
      const { rects } = cleanup(house, { ftPerPx: 0.1, fit });
      const spec = toSpec({ options: [{ letter: 'A', name: fit, description: '', rects }] });
      const { project, report } = buildProject(spec, { id: 'x' });
      const d = report.designs[0]!;
      expect(d.overlaps).toEqual([]);
      expect(d.unreachable).toEqual([]);
      expect(project.rooms).toHaveLength(5);
      expect(project.site.zones.length).toBeGreaterThanOrEqual(1);
      expect(project.site.gates.some((g) => g.kind === 'pedestrian')).toBe(true);
      expect(project.openings.some((o) => o.catalogId === 'door-double')).toBe(true);
    });
  }

  it('two options become two design options of one project', () => {
    const a = cleanup(house, { ftPerPx: 0.1, fit: 'labelled' }).rects;
    const b = cleanup(house, { ftPerPx: 0.1, fit: 'pictured' }).rects;
    const spec = toSpec({
      options: [
        { letter: 'A', name: 'As labelled', description: '', rects: a },
        { letter: 'B', name: 'As pictured', description: '', rects: b },
      ],
    });
    const { project } = buildProject(spec, { id: 'x' });
    expect(project.options.map((o) => o.letter)).toEqual(['B']);
    expect(project.currentOption.letter).toBe('A');
  });
});
