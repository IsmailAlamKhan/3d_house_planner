import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../model/schemas';
import { buildProject, describeReport, enclosedGaps, wallSegments } from './build';
import {
  ReferenceSpecSchema,
  type ReferenceSpecInput,
  parseReferenceSpec,
  polygonOf,
  rectToPolygon,
  unitFactor,
} from './spec';

const FT = 0.3048;

/** A tiny villa in feet: a hall with a wing on each side, a front garden, a gate, a terrace upstairs. */
const spec = (over: Partial<ReferenceSpecInput> = {}): ReferenceSpecInput => ({
  version: 1,
  name: 'Test villa',
  units: 'ft',
  plot: [
    [0, 0],
    [60, 0],
    [60, 80],
    [0, 80],
  ],
  levels: [
    { id: 'g', name: 'Ground floor', height: 10 },
    { id: 'u', name: 'Roof terrace', height: 9 },
  ],
  views: [{ name: 'Top', mode: 'top', position: [30, 120, 40], target: [30, 0, 40], zoom: 40 }],
  designs: [
    {
      id: 'A',
      letter: 'A',
      name: 'As labelled',
      rooms: [
        { id: 'hall', name: 'Hall', type: 'living', rect: [14, 10, 18, 28], labelSize: [18, 28] },
        {
          id: 'bed1',
          name: 'Bedroom 1',
          type: 'bedroom',
          rect: [0, 10, 14, 12],
          labelSize: [14, 12],
        },
        { id: 'bed2', name: 'Bedroom 2', type: 'bedroom', rect: [0, 22, 14, 12] },
        {
          id: 'foyer',
          name: 'Foyer',
          type: 'foyer',
          rect: [14, 38, 18, 8],
          wallFinish: 'paint-cream',
        },
        { id: 'kit', name: 'Kitchen', type: 'kitchen', rect: [32, 10, 16, 12] },
        {
          id: 'terrace',
          name: 'Terrace',
          type: 'outdoor',
          level: 'u',
          rect: [0, 10, 14, 24],
          parapet: true,
        },
      ],
      walls: [
        { from: [14, 30], to: [20, 30], type: 'partition', material: 'glass', thickness: 0.2 },
      ],
      openings: [
        { at: [23, 38], kind: 'door', style: 'door-double' },
        { at: [14, 16], kind: 'door' },
        { at: [14, 28], kind: 'door' },
        { at: [32, 16], kind: 'archway' },
        { at: [7, 10], kind: 'window', style: 'window-casement' },
      ],
      zones: [
        {
          id: 'fg',
          name: 'Front garden',
          type: 'garden',
          rect: [0, 50, 28, 26],
          labelSize: [28, 26],
        },
        {
          id: 'pool',
          name: 'Pool',
          type: 'pool',
          polygon: [
            [34, 52],
            [52, 52],
            [52, 66],
            [34, 66],
          ],
        },
      ],
      gates: [{ kind: 'pedestrian', at: [23, 80], facing: 'south' }],
      items: [
        { key: 'bed', catalog: 'bed-king', at: [7, 15], rotation: 0 },
        { catalog: 'sofa-3seat', at: [23, 30], rotation: 90, size: [7, 3, 3] },
      ],
      lines: [{ catalog: 'hedge', from: [2, 78], to: [20, 78], every: 6 }],
      stairs: [{ id: 's', from: 'g', to: 'u', at: [10, 20], direction: 90, width: 3.5 }],
      roofs: [{ level: 'u', rect: [0, 10, 14, 24] }],
      boundary: { hedges: { inset: 1, every: 6 }, lights: { inset: 0.5, every: 10 } },
    },
    {
      id: 'B',
      letter: 'B',
      name: 'As pictured',
      rooms: [
        { id: 'hall', name: 'Hall', type: 'living', rect: [14, 10, 16, 30] },
        { id: 'bed1', name: 'Bedroom 1', type: 'bedroom', rect: [0, 10, 14, 14] },
      ],
      openings: [{ at: [14, 16], kind: 'door' }],
      zones: [{ id: 'pool', name: 'Pool', type: 'pool', rect: [34, 52, 20, 14] }],
    },
  ],
  ...over,
});

describe('spec', () => {
  it('parses, fills defaults and converts units', () => {
    const s = parseReferenceSpec(spec());
    expect(s.designs[0]!.rooms[0]!.type).toBe('living');
    expect(s.designs[1]!.items).toEqual([]);
    expect(unitFactor('ft')).toBe(0.3048);
    expect(unitFactor('m')).toBe(1);
    expect(polygonOf({ rect: [1, 2, 3, 4] })).toEqual(rectToPolygon([1, 2, 3, 4]));
  });

  it('lists every problem in plain words', () => {
    const bad = spec({
      levels: [{ id: 'g', name: 'G', height: 10 }],
      designs: [
        {
          id: 'A',
          name: 'A',
          rooms: [
            { id: 'r', name: 'R', type: 'bedroom' } as never, // no shape
            { id: 'r', name: 'R2', type: 'bedroom', rect: [0, 0, 4, 4], level: 'nope' },
          ],
        },
      ],
    });
    expect(ReferenceSpecSchema.safeParse(bad).success).toBe(false);
    expect(() => parseReferenceSpec(bad)).toThrow(/rect.*polygon|duplicate room id|unknown level/s);
    expect(() => parseReferenceSpec({ ...spec(), designs: [] })).toThrow();
  });
});

describe('wall graph', () => {
  const sq = (x: number, y: number, w: number, d: number) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + d },
    { x, y: y + d },
  ];
  it('shares the edge between neighbours and cuts long edges at the corners of short ones', () => {
    const segs = wallSegments([
      { id: 'a', points: sq(0, 0, 4, 6) },
      { id: 'b', points: sq(4, 0, 4, 3) },
      { id: 'c', points: sq(4, 3, 4, 3) },
    ]);
    // a's right edge (x = 4, y 0..6) is cut at y = 3 and shared with b and c.
    const shared = segs.filter((s) => s.owners.length === 2);
    expect(shared).toHaveLength(3); // a|b, a|c and b|c
    expect(shared.filter((s) => s.a.x === 4 && s.b.x === 4)).toHaveLength(2); // a's right side, cut at y = 3
    // b|c share y = 3, x 4..8
    expect(segs.some((s) => s.owners.includes('b') && s.owners.includes('c'))).toBe(true);
    // every segment is owned by at least one room, and none is duplicated
    expect(new Set(segs.map((s) => `${s.a.x},${s.a.y}|${s.b.x},${s.b.y}`)).size).toBe(segs.length);
    const outer = segs.filter((s) => s.owners.length === 1);
    expect(outer.length).toBeGreaterThanOrEqual(6);
  });

  it('finds enclosed gaps (a hole surrounded by rooms) and ignores a plain outline', () => {
    expect(enclosedGaps([sq(0, 0, 4, 4)])).toEqual([]);
    const ring = [sq(0, 0, 10, 3), sq(0, 7, 10, 3), sq(0, 3, 3, 4), sq(7, 3, 3, 4)];
    const gaps = enclosedGaps(ring);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeCloseTo(16, 6);
  });
});

describe('exact builder', () => {
  const { project, report } = buildProject(spec());
  const A = report.designs[0]!;

  it('puts every room exactly where the spec says (sizes to the millimetre)', () => {
    const hall = project.rooms.find((r) => r.name === 'Hall')!;
    const xs = hall.polygon.map((p) => p.x);
    const ys = hall.polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(14 * FT, 9);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(18 * FT, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(28 * FT, 9);
    const bed = project.rooms.find((r) => r.name === 'Bedroom 1')!;
    expect(
      Math.max(...bed.polygon.map((p) => p.x)) - Math.min(...bed.polygon.map((p) => p.x)),
    ).toBeCloseTo(14 * FT, 9);
    expect(project.units).toBe('imperial');
    expect(project.kind).toBe('villa');
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it('draws one wall per shared edge, inside walls between rooms and outside walls around them', () => {
    const g = project.walls.filter((w) => w.levelId === 'g');
    const hallBed = g.filter(
      (w) =>
        w.type === 'interior' &&
        Math.abs(w.start.x - 14 * FT) < 1e-6 &&
        Math.abs(w.end.x - 14 * FT) < 1e-6,
    );
    expect(hallBed.length).toBeGreaterThanOrEqual(2); // bedroom 1 and 2 share the hall's west side
    expect(g.filter((w) => w.type === 'exterior').length).toBeGreaterThan(4);
    const glass = g.find((w) => w.materialInside === 'glass')!;
    expect(glass.type).toBe('partition');
    expect(glass.thickness).toBeCloseTo(0.2 * FT, 9);
    // wall finish of the foyer shows on its faces
    const cream = g.filter(
      (w) => w.materialInside === 'paint-cream' || w.materialOutside === 'paint-cream',
    );
    expect(cream.length).toBeGreaterThanOrEqual(1);
  });

  it('puts doors and windows on the nearest wall, centred where asked', () => {
    const door = project.openings.find((o) => o.catalogId === 'door-double')!;
    expect(door).toBeDefined();
    const wall = project.walls.find((w) => w.id === door.wallId)!;
    // the foyer's front wall runs along y = 46 ft … but the door asked for y = 38 (the hall/foyer wall)
    const t = door.offset / Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const cx = wall.start.x + (wall.end.x - wall.start.x) * t;
    expect(cx).toBeCloseTo(23 * FT, 6);
    expect(project.openings.some((o) => o.kind === 'archway')).toBe(true);
    expect(project.openings.some((o) => o.kind === 'window')).toBe(true);
    expect(project.shell.entrance.position.x).toBeCloseTo(23 * FT, 6);
  });

  it('places zones, gates, items (degrees → radians, sizes → scale) and rows of items', () => {
    expect(project.site.zones.map((z) => z.name).sort()).toEqual(['Front garden', 'Pool']);
    expect(project.site.gates).toHaveLength(1);
    expect(project.site.gates[0]!.direction).toBeCloseTo(Math.PI / 2, 9);
    const sofa = project.items.find((i) => i.catalogId === 'sofa-3seat')!;
    expect(sofa.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(sofa.scale.x).toBeCloseTo((7 * FT) / 2.2, 6);
    expect(project.items.filter((i) => i.catalogId === 'hedge').length).toBeGreaterThanOrEqual(3);
  });

  it('plants along the inside of the plot boundary, not outside it', () => {
    const edge = project.items.filter((i) => i.catalogId === 'garden-light');
    expect(edge.length).toBeGreaterThan(8);
    for (const it of edge) {
      expect(it.position.x).toBeGreaterThanOrEqual(0);
      expect(it.position.x).toBeLessThanOrEqual(60 * FT);
      expect(it.position.y).toBeGreaterThanOrEqual(0);
      expect(it.position.y).toBeLessThanOrEqual(80 * FT);
    }
    // inset of 0.5 ft: every light is within 0.6 ft of some edge, and none sits on it
    const nearest = (p: { x: number; y: number }) =>
      Math.min(p.x, 60 * FT - p.x, p.y, 80 * FT - p.y) / FT;
    expect(edge.every((i) => Math.abs(nearest(i.position) - 0.5) < 0.05)).toBe(true);
  });

  it('builds the terrace level: parapet, roof and the stair up', () => {
    expect(project.levels.map((l) => l.name)).toEqual(['Ground floor', 'Roof terrace']);
    expect(project.levels[1]!.elevation).toBeGreaterThan(project.levels[0]!.floorToCeiling);
    expect(project.stairs).toHaveLength(1);
    expect(project.stairs[0]!.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(project.roofs).toHaveLength(1);
    const terrace = project.rooms.find((r) => r.name === 'Terrace')!;
    expect(terrace.levelId).toBe('u');
    expect(
      project.walls.filter((w) => w.levelId === 'u').every((w) => (w.height ?? 3) <= 1.01),
    ).toBe(true);
  });

  it('keeps the second design as an option with its own rooms and outdoor zones', () => {
    expect(project.currentOption).toMatchObject({ letter: 'A', name: 'As labelled' });
    expect(project.options).toHaveLength(1);
    const b = project.options[0]!;
    expect(b.letter).toBe('B');
    expect(b.design.rooms.map((r) => r.name).sort()).toEqual(['Bedroom 1', 'Hall']);
    expect(b.design.zones![0]!.name).toBe('Pool');
    const pool = b.design.zones![0]!;
    const w = Math.max(...pool.polygon.map((p) => p.x)) - Math.min(...pool.polygon.map((p) => p.x));
    expect(w).toBeCloseTo(20 * FT, 9);
    expect(project.views.map((v) => v.name)).toEqual(['Top']);
  });

  it('reports what it did: counts, no overlaps, and the rooms that cannot be reached', () => {
    expect(A.rooms).toBe(6);
    expect(A.overlaps).toEqual([]);
    expect(A.walls).toBeGreaterThan(10);
    // Kitchen has an archway to nothing it connects through? It does touch the hall via x = 32; the terrace room is
    // on another level and reached by the stair; Bedroom 2 has a door to the hall — so nothing is unreachable here.
    expect(A.unreachable).toEqual([]);
    expect(describeReport(report)).toContain('Design A "As labelled"');
  });
});

describe('builder reports problems instead of hiding them', () => {
  it('finds overlapping rooms and enclosed gaps', () => {
    const s = spec({
      designs: [
        {
          id: 'A',
          name: 'A',
          rooms: [
            { id: 'a', name: 'A', type: 'bedroom', rect: [0, 0, 10, 10] },
            { id: 'b', name: 'B', type: 'bedroom', rect: [8, 0, 10, 10] }, // overlaps a by 2 × 10 ft
            { id: 'n', name: 'N', type: 'bedroom', rect: [30, 0, 30, 5] },
            { id: 's', name: 'S', type: 'bedroom', rect: [30, 15, 30, 5] },
            { id: 'w', name: 'W', type: 'bedroom', rect: [30, 5, 5, 10] },
            { id: 'e', name: 'E', type: 'bedroom', rect: [55, 5, 5, 10] }, // hole 20 × 10 ft in between
          ],
        },
      ],
    });
    const { report } = buildProject(s);
    const d = report.designs[0]!;
    expect(d.overlaps).toHaveLength(1);
    expect(d.overlaps[0]!.area).toBeCloseTo(20 * FT * FT, 6);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]!.area).toBeCloseTo(200 * FT * FT, 6);
  });

  it('warns about an opening that is on no wall, and narrows one that does not fit', () => {
    const s = spec();
    s.designs[0]!.openings = [
      { at: [100, 100], kind: 'door' },
      { at: [14, 16], kind: 'door', width: 30 },
    ];
    const { report, project } = buildProject(s);
    const w = report.designs[0]!.warnings;
    expect(w.some((x) => /not on any wall/.test(x))).toBe(true);
    expect(w.some((x) => /narrowed/.test(x))).toBe(true);
    expect(project.openings).toHaveLength(1);
  });

  it('lists rooms that have no way in', () => {
    const s = spec();
    s.designs[0]!.openings = [{ at: [23, 38], kind: 'door', style: 'door-double' }]; // only the foyer door
    const { report } = buildProject(s);
    expect(report.designs[0]!.unreachable.length).toBeGreaterThan(0);
  });

  it('warns about an unknown catalogue item and an item outside the plot', () => {
    const s = spec();
    s.designs[0]!.items = [
      { catalog: 'does-not-exist', at: [5, 5] },
      { catalog: 'plant', at: [500, 5] },
    ];
    const w = buildProject(s).report.designs[0]!.warnings;
    expect(w.some((x) => /unknown catalogue item/.test(x))).toBe(true);
    expect(w.some((x) => /outside/.test(x))).toBe(true);
  });

  it('is deterministic: the same spec gives the same plan', () => {
    const strip = (p: ReturnType<typeof buildProject>['project']) =>
      JSON.stringify({
        rooms: p.rooms.map((r) => [r.name, r.polygon]),
        walls: p.walls.map((w) => [w.start, w.end, w.type, w.materialInside, w.materialOutside]),
        openings: p.openings.map((o) => [o.offset, o.width, o.catalogId]),
        items: p.items.map((i) => [i.catalogId, i.position, i.rotation]),
      });
    expect(strip(buildProject(spec()).project)).toBe(strip(buildProject(spec()).project));
  });
});
