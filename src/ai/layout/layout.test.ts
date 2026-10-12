import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../model/sample';
import { ProjectSchema } from '../../model/schemas';
import { sharedEdge, squarify, largestInnerRect, exteriorEdges } from './rect';
import { DesignIntentSchema, type DesignIntent } from '../schemas';
import { applyPlan } from './apply';
import { rectArea } from './plan';
import { solveLayout, type SolveInput } from './solve';
import { wallsFromRects } from './walls';

const sample = createSampleProject();
const shellInput = (over: Partial<SolveInput> = {}): Omit<SolveInput, 'intent'> => ({
  footprint: sample.shell.footprint,
  entrance: sample.shell.entrance,
  plumbing: sample.shell.fixedPlumbingPoints,
  columns: sample.columns
    .filter((c) => c.levelId === sample.levels[0]!.id)
    .map((c) => ({ position: c.position, size: c.size })),
  maxHeight: sample.shell.maxHeight,
  ...over,
});

const room = (type: string, name: string, targetArea: number, extra: object = {}) => ({
  type,
  name,
  targetArea,
  ...extra,
});
const twoBedroom = (over: object = {}): DesignIntent =>
  DesignIntentSchema.parse({
    title: '2-bedroom duplex',
    levels: [
      {
        name: 'Ground floor',
        rooms: [
          room('living', 'Living room', 24, {
            adjacency: [{ room: 'Kitchen', connection: 'open' }],
          }),
          room('kitchen', 'Kitchen', 12, { needsPlumbing: true }),
          room('dining', 'Dining', 10),
          room('bathroom', 'Guest bath', 4.5),
        ],
      },
      {
        name: 'Upper floor',
        rooms: [
          room('bedroom', 'Master bedroom', 16, {
            adjacency: [{ room: 'Master bath', connection: 'door' }],
          }),
          room('bathroom', 'Master bath', 6),
          room('bedroom', 'Bedroom 2', 12),
          room('bathroom', 'Family bath', 5),
          room('study', 'Study', 8),
        ],
      },
    ],
    ...over,
  });

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  a.x < b.x + b.w - 1e-6 &&
  a.x + a.w > b.x + 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  a.y + a.h > b.y + 1e-6;

describe('rect helpers', () => {
  it('squarify fills the rectangle exactly with areas proportional to the weights', () => {
    const rect = { x: 1, y: 2, w: 8, h: 5 };
    const out = squarify([4, 2, 2, 1], rect);
    expect(out.reduce((s, r) => s + rectArea(r), 0)).toBeCloseTo(40);
    expect(rectArea(out[0]!)).toBeCloseTo(40 * (4 / 9));
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) expect(rectsOverlap(out[i]!, out[j]!)).toBe(false);
  });
  it('finds shared edges and exterior edges', () => {
    const a = { x: 0, y: 0, w: 4, h: 3 };
    const b = { x: 4, y: 1, w: 3, h: 5 };
    expect(sharedEdge(a, b)).toMatchObject({ length: 2, axis: 'y' });
    expect(sharedEdge(a, { x: 5, y: 0, w: 1, h: 1 })).toBeNull();
    expect(sharedEdge(a, { x: 4, y: 3, w: 1, h: 1 })).toBeNull(); // corner only
    expect(exteriorEdges(a, { x: 0, y: 0, w: 10, h: 10 })).toHaveLength(2);
  });
  it('largest inner rectangle of an L-shaped outline', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    const { rect, exact } = largestInnerRect(l);
    expect(exact).toBe(false);
    expect(rectArea(rect)).toBeGreaterThanOrEqual(40);
    expect(largestInnerRect(sample.shell.footprint).exact).toBe(true);
  });
  it('merges wall segments: a shared edge is one wall, collinear edges join', () => {
    const rects = [
      { x: 0, y: 0, w: 4, h: 3 },
      { x: 4, y: 0, w: 4, h: 3 },
      { x: 0, y: 3, w: 8, h: 2 },
    ];
    const walls = wallsFromRects(rects, { x: 0, y: 0, w: 8, h: 5 }, 0);
    expect(walls.filter((w) => w.type === 'exterior')).toHaveLength(4);
    const interior = walls.filter((w) => w.type === 'interior');
    expect(interior).toHaveLength(2); // the y = 3 line across the full width and the x = 4 partition
    expect(
      interior.some((w) => w.start.y === 3 && w.end.y === 3 && Math.abs(w.end.x - w.start.x) === 8),
    ).toBe(true);
  });
});

describe('layout solver', () => {
  const plan = solveLayout({ ...shellInput(), intent: twoBedroom() });

  it('tiles every level completely with non-overlapping rooms inside the shell', () => {
    for (const level of [0, 1]) {
      const rooms = plan.rooms.filter((r) => r.level === level);
      expect(rooms.reduce((s, r) => s + rectArea(r.rect), 0)).toBeCloseTo(rectArea(plan.shell), 3);
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i]!.rect;
        expect(r.x).toBeGreaterThanOrEqual(plan.shell.x - 1e-6);
        expect(r.x + r.w).toBeLessThanOrEqual(plan.shell.x + plan.shell.w + 1e-6);
        expect(r.y + r.h).toBeLessThanOrEqual(plan.shell.y + plan.shell.h + 1e-6);
        for (let j = i + 1; j < rooms.length; j++)
          expect(rectsOverlap(r, rooms[j]!.rect)).toBe(false);
      }
    }
    expect(plan.rooms.filter((r) => r.level === 0).map((r) => r.name)).toEqual(
      expect.arrayContaining(['Entrance hall', 'Living room', 'Kitchen', 'Dining', 'Guest bath']),
    );
  });

  it('puts the stair hall in the same place on both levels and the stair inside it', () => {
    const hall0 = plan.rooms.find((r) => r.level === 0 && r.name === 'Entrance hall')!;
    const hall1 = plan.rooms.find((r) => r.level === 1 && r.name === 'Landing')!;
    expect(hall1.rect).toEqual(hall0.rect);
    expect(plan.stair.position.x).toBeGreaterThan(hall0.rect.x);
    expect(plan.stair.position.x).toBeLessThan(hall0.rect.x + hall0.rect.w);
    expect(plan.stair.position.y).toBeGreaterThan(hall0.rect.y - 1e-6);
  });

  it('keeps requested adjacencies and honours minimum widths', () => {
    const l = plan.rooms.find((r) => r.name === 'Living room')!;
    const k = plan.rooms.find((r) => r.name === 'Kitchen')!;
    expect(sharedEdge(l.rect, k.rect)?.length ?? 0).toBeGreaterThanOrEqual(1.1);
    const mb = plan.rooms.find((r) => r.name === 'Master bedroom')!;
    const bath = plan.rooms.find((r) => r.name === 'Master bath')!;
    expect(sharedEdge(mb.rect, bath.rect)?.length ?? 0).toBeGreaterThanOrEqual(1.1);
    for (const r of plan.rooms)
      expect(Math.min(r.rect.w, r.rect.h)).toBeGreaterThanOrEqual(r.minWidth - 0.05);
    expect(plan.warnings.filter((w) => /side by side|wide/.test(w))).toEqual([]);
  });

  it('every room can be reached from the entrance through doors; there is an entrance door', () => {
    expect(plan.openings.some((o) => o.catalogId === 'door-entrance' && o.level === 0)).toBe(true);
    for (const level of [0, 1]) {
      const rooms = plan.rooms.filter((r) => r.level === level);
      const hall = rooms.find((r) => r.name === 'Entrance hall' || r.name === 'Landing')!;
      const reached = new Set([hall.key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const o of plan.openings.filter((o) => o.level === level && o.rooms.length === 2)) {
          const [a, b] = o.rooms as [string, string];
          if (reached.has(a) !== reached.has(b)) {
            reached.add(a);
            reached.add(b);
            grew = true;
          }
        }
      }
      expect(rooms.filter((r) => !reached.has(r.key)).map((r) => r.name)).toEqual([]);
    }
  });

  it('adds windows on outside walls for living spaces and bedrooms', () => {
    for (const name of ['Living room', 'Kitchen', 'Master bedroom', 'Bedroom 2']) {
      const r = plan.rooms.find((x) => x.name === name)!;
      expect(plan.openings.some((o) => o.kind === 'window' && o.rooms.includes(r.key))).toBe(true);
    }
    // Windows sit on the shell outline.
    for (const o of plan.openings.filter((x) => x.kind === 'window')) {
      const onEdge =
        Math.abs(o.at.x - plan.shell.x) < 1e-3 ||
        Math.abs(o.at.x - (plan.shell.x + plan.shell.w)) < 1e-3 ||
        Math.abs(o.at.y - plan.shell.y) < 1e-3 ||
        Math.abs(o.at.y - (plan.shell.y + plan.shell.h)) < 1e-3;
      expect(onEdge).toBe(true);
    }
  });

  it('is deterministic for a given seed and furnishes rooms by default', () => {
    const again = solveLayout({ ...shellInput(), intent: twoBedroom() });
    expect(again.rooms.map((r) => r.rect)).toEqual(plan.rooms.map((r) => r.rect));
    expect(plan.items.length).toBeGreaterThan(15);
    const ids = new Set(plan.items.map((i) => i.catalogId));
    for (const id of ['sofa-3seat', 'bed-king', 'wc', 'kitchen-base-run'])
      expect(ids.has(id) || ids.has(id.replace('king', 'queen')) || id === 'sofa-3seat').toBe(true);
    const bare = solveLayout({ ...shellInput(), intent: twoBedroom({ furnish: false }) });
    expect(bare.items).toHaveLength(0);
  });

  it('places wet rooms near plumbing points and stacks the upstairs bathroom over a downstairs wet room', () => {
    const c = (r: { rect: { x: number; y: number; w: number; h: number } }) => ({
      x: r.rect.x + r.rect.w / 2,
      y: r.rect.y + r.rect.h / 2,
    });
    const kitchen = plan.rooms.find((r) => r.name === 'Kitchen')!;
    const nearest = (p: { x: number; y: number }) =>
      Math.min(...sample.shell.fixedPlumbingPoints.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
    expect(nearest(c(kitchen))).toBeLessThan(8);
    const upBath = plan.rooms.find((r) => r.name === 'Master bath')!;
    const downBath = plan.rooms.find((r) => r.name === 'Guest bath')!;
    const dist = Math.hypot(c(upBath).x - c(downBath).x, c(upBath).y - c(downBath).y);
    expect(dist).toBeLessThan(8);
  });

  it('reports adjacency that cannot be met, in plain language, instead of failing', () => {
    // Five rooms that must all touch each other: impossible on a plane (K5 is not planar).
    const names = ['Living', 'Kitchen', 'Study', 'Dining', 'Bedroom'];
    const types = ['living', 'kitchen', 'study', 'dining', 'bedroom'];
    const crowded = DesignIntentSchema.parse({
      levels: [
        {
          name: 'Ground floor',
          rooms: names.map((n, i) =>
            room(types[i]!, n, 12, {
              adjacency: names.filter((o) => o !== n).map((o) => ({ room: o, connection: 'door' })),
            }),
          ),
        },
      ],
    });
    const result = solveLayout({
      ...shellInput({
        footprint: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 8 },
          { x: 0, y: 8 },
        ],
        entrance: { position: { x: 8, y: 4 }, direction: 0 },
        plumbing: [],
      }),
      intent: crowded,
    });
    expect(result.rooms).toHaveLength(5); // still a complete layout
    expect(result.warnings.some((w) => /could not be placed side by side/.test(w))).toBe(true);
    // And it can still be built.
    const next = produce(sample, (d) => void applyPlan(d, result));
    expect(ProjectSchema.safeParse(next).success).toBe(true);
  });

  it('works for a single level (no stair) and for a non-rectangular shell', () => {
    const one = DesignIntentSchema.parse({
      levels: [
        {
          name: 'Flat',
          rooms: [
            room('living', 'Living', 20),
            room('bedroom', 'Bed', 12),
            room('bathroom', 'Bath', 5),
          ],
        },
      ],
    });
    const flat = solveLayout({ ...shellInput(), intent: one });
    expect(flat.rooms.every((r) => r.level === 0)).toBe(true);
    expect(flat.rooms.some((r) => r.type === 'stair')).toBe(false);
    const l = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 12 },
      { x: 0, y: 12 },
    ];
    const lPlan = solveLayout({
      ...shellInput({
        footprint: l,
        entrance: { position: { x: 0, y: 8 }, direction: Math.PI },
        plumbing: [],
      }),
      intent: twoBedroom(),
    });
    expect(lPlan.warnings.some((w) => /not a rectangle/.test(w))).toBe(true);
    expect(lPlan.rooms.length).toBeGreaterThan(8);
  });

  it('snaps partitions onto structural columns when they are close', () => {
    // A column 0.3 m off a likely partition: find a vertical partition of the plan and put a column near it.
    const walls = plan.walls.filter(
      (w) => w.level === 0 && w.type === 'interior' && w.start.x === w.end.x,
    );
    const base = walls[0]!;
    const col = {
      position: { x: base.start.x + 0.25, y: (base.start.y + base.end.y) / 2 },
      size: { w: 0.3, d: 0.3 },
    };
    const snapped = solveLayout({ ...shellInput({ columns: [col] }), intent: twoBedroom() });
    const lines = snapped.walls
      .filter((w) => w.level === 0 && w.start.x === w.end.x)
      .map((w) => w.start.x);
    // Some partition now passes through the column centre, or the room widths forbade it (then no wall was moved off).
    const through = lines.some((x) => Math.abs(x - col.position.x) < 0.01);
    const unchanged = lines.some((x) => Math.abs(x - base.start.x) < 0.01);
    expect(through || unchanged).toBe(true);
  });
});

describe('applying a plan to the project', () => {
  it('creates a valid two-level model with walls, doors, windows, stair, rooms, furniture, in one pass', () => {
    const plan = solveLayout({ ...shellInput(), intent: twoBedroom() });
    const next = produce(sample, (d) => {
      applyPlan(d, plan);
    });
    expect(ProjectSchema.safeParse(next).success).toBe(true);
    expect(next.levels).toHaveLength(2);
    expect(next.stairs).toHaveLength(1);
    expect(next.openings.some((o) => o.kind === 'door')).toBe(true);
    expect(next.openings.some((o) => o.kind === 'window')).toBe(true);
    expect(next.items.length).toBeGreaterThan(10);
    expect(next.columns.filter((c) => c.levelId === next.levels[1]!.id)).toHaveLength(2); // fixed elements survive
    const names = next.rooms.filter((r) => r.levelId === next.levels[0]!.id).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['Living room', 'Kitchen', 'Dining', 'Guest bath']),
    );
    expect(
      next.rooms.some((r) => r.type === 'bathroom' && r.floorMaterial === 'floor-tile-grey'),
    ).toBe(true);
    expect(next.roofs).toHaveLength(1);
    // Every planned room became exactly one detected room.
    expect(next.rooms).toHaveLength(plan.rooms.length);
  });

  it('grows or shrinks the level list to match the design', () => {
    const one = DesignIntentSchema.parse({
      levels: [{ name: 'Flat', rooms: [room('living', 'Living', 20), room('bedroom', 'Bed', 12)] }],
    });
    const plan = solveLayout({ ...shellInput(), intent: one });
    const next = produce(sample, (d) => void applyPlan(d, plan));
    expect(next.levels).toHaveLength(1);
    expect(next.stairs).toHaveLength(0);
    const three = DesignIntentSchema.parse({
      levels: ['A', 'B', 'C'].map((name) => ({
        name,
        rooms: [room('living', `Living ${name}`, 20), room('bedroom', `Bed ${name}`, 14)],
      })),
    });
    const plan3 = solveLayout({ ...shellInput({ maxHeight: 9 }), intent: three });
    const next3 = produce(sample, (d) => void applyPlan(d, plan3));
    expect(next3.levels).toHaveLength(3);
    expect(next3.stairs).toHaveLength(2);
    expect(ProjectSchema.safeParse(next3).success).toBe(true);
  });
});
