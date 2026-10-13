import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../checks';
import { pointInPolygon } from '../geometry/polygon';
import { createEmptyProject } from '../model/project';
import { createSampleProject } from '../model/sample';
import { VILLA_TEMPLATE } from '../templates';
import { planTemplate, projectWithTemplate } from '../wizard/finish';
import { projectFromConfig, defaultConfig, villaConfigPlaced, footprintOf } from '../wizard/shell';
import { applyPlan } from './layout/apply';
import { solveLayout } from './layout/solve';
import { isVillaBrief, offlineVilla } from './offlineVilla';
import { offlineIntent } from './offline';
import { DesignIntentSchema } from './schemas';

const BRIEF = 'luxury villa with pool, garden, 2-car garage, gym and sauna';

const villaProject = () =>
  projectFromConfig({
    ...defaultConfig(),
    kind: 'villa',
    shape: 'rectangle',
    width: 18,
    depth: 16,
    plotW: 34,
    plotD: 42,
    storeys: 1,
    groundHeight: 3,
  });

describe('villa brief → design intent', () => {
  it('recognises villa briefs and leaves duplex briefs alone', () => {
    expect(isVillaBrief(BRIEF)).toBe(true);
    expect(isVillaBrief('3-bedroom duplex with open kitchen')).toBe(false);
    const duplex = offlineIntent('2 bedroom duplex');
    expect(duplex.intent.strategy).toBe('duplex');
    expect(duplex.intent.levels).toHaveLength(2);
  });

  it('turns the luxury-villa brief into foyer, hall, wings, gym, sauna and outdoor zones', () => {
    const { intent, understood } = offlineIntent(BRIEF);
    expect(intent.strategy).toBe('wings');
    expect(intent.levels).toHaveLength(1);
    const types = intent.levels[0]!.rooms.map((r) => r.type);
    for (const t of [
      'foyer',
      'living',
      'kitchen',
      'bedroom',
      'bathroom',
      'walk-in-closet',
      'gym',
      'sauna',
    ])
      expect(types).toContain(t);
    const zones = intent.site!.zones.map((z) => z.type);
    for (const z of ['pool', 'deck', 'parking', 'garden', 'lawn', 'patio'])
      expect(zones).toContain(z);
    expect(intent.site!.cars).toBe(2);
    expect(intent.site!.zones.find((z) => z.type === 'parking')!.covered).toBe(true);
    expect(understood.join(' ')).toMatch(/2 car/);
  });

  it('reads counts and extra rooms', () => {
    const { intent } = offlineVilla(
      'villa with 4 bedrooms, guest room, game room, home theatre, spa, 3 cars',
    );
    const rooms = intent.levels[0]!.rooms;
    expect(rooms.filter((r) => r.type === 'bedroom').length).toBeGreaterThanOrEqual(5); // 4 + guest
    for (const t of ['game-room', 'home-theatre', 'spa'])
      expect(rooms.map((r) => r.type)).toContain(t);
    expect(intent.site!.cars).toBe(3);
    expect(DesignIntentSchema.safeParse(intent).success).toBe(true);
  });

  it('variations differ but stay valid', () => {
    const a = offlineIntent(BRIEF, 0).intent;
    const b = offlineIntent(BRIEF, 1).intent;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(DesignIntentSchema.safeParse(b).success).toBe(true);
  });
});

describe('wings layout and site plan', () => {
  const p0 = villaProject();
  const input = {
    footprint: p0.shell.footprint,
    entrance: p0.shell.entrance,
    plumbing: [],
    columns: [],
    maxHeight: p0.shell.maxHeight,
    plot: p0.site.plot,
  };

  it('puts a foyer at the front, a central hall and rooms in two wings, all reachable', () => {
    const { intent } = offlineIntent(BRIEF);
    const plan = solveLayout({ intent, ...input });
    const room = (n: string) => plan.rooms.find((r) => r.name === n)!;
    const hall = room('Living & Dining');
    const foyer = room('Foyer');
    const shell = plan.shell;
    // Foyer on the entrance (bottom) side, in line with the hall.
    expect(foyer.rect.y + foyer.rect.h).toBeCloseTo(shell.y + shell.h);
    expect(foyer.rect.x).toBeCloseTo(hall.rect.x);
    expect(foyer.rect.w).toBeCloseTo(hall.rect.w);
    // The hall is in the middle: rooms on both sides of it.
    const others = plan.rooms.filter((r) => r !== hall && r !== foyer);
    expect(others.some((r) => r.rect.x + r.rect.w <= hall.rect.x + 1e-6)).toBe(true);
    expect(others.some((r) => r.rect.x >= hall.rect.x + hall.rect.w - 1e-6)).toBe(true);
    // Rooms tile the building without overlap.
    const area = plan.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
    expect(area).toBeCloseTo(shell.w * shell.h, 0);
    expect(plan.warnings.join(' ')).not.toMatch(/could not be reached/);
  });

  it('keeps a bedroom next to its bathroom and closet', () => {
    const { intent } = offlineIntent(BRIEF);
    const plan = solveLayout({ intent, ...input });
    const r = (n: string) => plan.rooms.find((x) => x.name === n)!.rect;
    const touch = (a: ReturnType<typeof r>, b: ReturnType<typeof r>) =>
      Math.abs(a.x + a.w - b.x) < 1e-6 ||
      Math.abs(b.x + b.w - a.x) < 1e-6 ||
      Math.abs(a.y + a.h - b.y) < 1e-6 ||
      Math.abs(b.y + b.h - a.y) < 1e-6;
    expect(touch(r('Master bedroom'), r('Master bath'))).toBe(true);
    expect(touch(r('Master bedroom'), r('Walk-in closet'))).toBe(true);
  });

  it('plans zones inside the plot, a path to the entrance, gates and a car per bay', () => {
    const { intent } = offlineIntent(BRIEF);
    const plan = solveLayout({ intent, ...input });
    const site = plan.site!;
    expect(site.zones.length).toBeGreaterThanOrEqual(7);
    for (const z of site.zones)
      for (const c of z.polygon) expect(pointInPolygon(c, input.plot, 1e-6)).toBe(true);
    expect(site.gates.map((g) => g.kind).sort()).toEqual(['pedestrian', 'vehicle']);
    expect(site.items.filter((i) => i.catalogId === 'car')).toHaveLength(2);
    expect(site.items.some((i) => i.catalogId === 'sun-lounger')).toBe(true);
    // No two zones overlap (their rectangles only touch).
    const rects = site.zones.map((z) => {
      const xs = z.polygon.map((c) => c.x);
      const ys = z.polygon.map((c) => c.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  });

  it('with no plot there is no site plan', () => {
    const { intent } = offlineIntent(BRIEF);
    expect(solveLayout({ intent, ...input, plot: undefined }).site).toBeUndefined();
  });

  it('the wings strategy falls back (with a note) when the building is too small', () => {
    const { intent } = offlineIntent(BRIEF);
    const small = [
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 7 },
      { x: 0, y: 7 },
    ];
    const plan = solveLayout({
      intent,
      ...input,
      footprint: small,
      entrance: { position: { x: 4, y: 7 }, direction: Math.PI / 2 },
    });
    expect(plan.warnings.join(' ')).toMatch(/too small/);
    expect(plan.rooms.length).toBeGreaterThan(3);
  });
});

describe('applying a villa design', () => {
  it('builds a valid project with rooms, outdoor zones and gates; checks run and report in plain language', () => {
    const base = villaProject();
    const { intent } = offlineIntent(BRIEF);
    const plan = solveLayout({
      intent,
      footprint: base.shell.footprint,
      entrance: base.shell.entrance,
      plumbing: [],
      columns: [],
      maxHeight: base.shell.maxHeight,
      plot: base.site.plot,
    });
    const p = produce(base, (d) => void applyPlan(d, plan, intent.style));
    expect(p.levels).toHaveLength(1);
    expect(p.stairs).toHaveLength(0); // a single-level villa needs no stair
    expect(p.rooms.map((r) => r.type)).toEqual(
      expect.arrayContaining(['foyer', 'gym', 'sauna', 'walk-in-closet']),
    );
    expect(p.site.zones.map((z) => z.type)).toEqual(
      expect.arrayContaining(['pool', 'deck', 'parking', 'lawn']),
    );
    expect(p.site.gates).toHaveLength(2);
    expect(p.items.some((i) => i.catalogId === 'car')).toBe(true);
    const issues = runChecks(p);
    for (const i of issues) expect(i.message.length).toBeGreaterThan(10);
    expect(issues.filter((i) => i.rule === 'setback')).toHaveLength(0);
    expect(issues.filter((i) => i.rule === 'gate-parking' || i.rule === 'gate-path')).toHaveLength(
      0,
    );
    expect(issues.filter((i) => i.rule === 'unreachable')).toHaveLength(0);
  });

  it('the "Luxury villa" template reproduces the reference arrangement', () => {
    const base = villaProject();
    const plan = planTemplate(base, VILLA_TEMPLATE);
    const names = plan.rooms.map((r) => r.name);
    for (const n of [
      'Foyer',
      'Living & Dining',
      'Kitchen',
      'Master bedroom',
      'Gym',
      'Sauna',
      'Spa',
      'Game room',
      'Guest room',
    ])
      expect(names).toContain(n);
    const p = projectWithTemplate(base, VILLA_TEMPLATE);
    expect(p.kind).toBe('villa');
    expect(p.site.zones.map((z) => z.type)).toEqual(
      expect.arrayContaining(['pool', 'parking', 'garden', 'play']),
    );
    expect(p.site.zones.find((z) => z.type === 'parking')!.covered).toBe(true);
    expect(runChecks(p).every((i) => typeof i.message === 'string')).toBe(true);
  });

  it('applying to an apartment ignores the site', () => {
    const base = createSampleProject();
    const { intent } = offlineIntent('2 bedroom duplex');
    const plan = solveLayout({
      intent,
      footprint: base.shell.footprint,
      entrance: base.shell.entrance,
      plumbing: base.shell.fixedPlumbingPoints,
      columns: [],
      maxHeight: base.shell.maxHeight,
    });
    const p = produce(base, (d) => void applyPlan(d, plan, intent.style));
    expect(p.kind).toBe('apartment');
    expect(p.site.zones).toHaveLength(0);
    expect(p.stairs).toHaveLength(1);
  });
});

describe('villa wizard', () => {
  it('creates a plot, places the building inside it, adds a gate and a path to the entrance', () => {
    const p = villaProject();
    expect(p.kind).toBe('villa');
    expect(p.site.plot).toHaveLength(4);
    expect(p.site.gates.map((g) => g.kind)).toEqual(['pedestrian']);
    expect(p.site.zones.map((z) => z.type)).toEqual(['path']);
    for (const c of p.shell.footprint) expect(pointInPolygon(c, p.site.plot)).toBe(true);
    expect(p.shell.entrance.position.y).toBeCloseTo(Math.max(...p.shell.footprint.map((c) => c.y)));
    expect(p.levels).toHaveLength(1);
  });

  it('supports 1–3 storeys and a U-shaped building', () => {
    const c = {
      ...defaultConfig(),
      kind: 'villa' as const,
      shape: 'U' as const,
      width: 18,
      depth: 14,
      notchW: 6,
      notchD: 6,
      plotW: 34,
      plotD: 42,
    };
    expect(footprintOf(c)).toHaveLength(8);
    for (const n of [1, 2, 3]) {
      const p = projectFromConfig({ ...c, storeys: n, groundHeight: 3 });
      expect(p.levels).toHaveLength(n);
      expect(p.shell.maxHeight).toBeCloseTo(n * 3 + (n - 1) * 0.2);
    }
    const placed = villaConfigPlaced(c);
    expect(placed.shape).toBe('custom');
  });

  it('a two-storey villa still gets a stair and a void-safe layout from the duplex strategy', () => {
    const base = projectFromConfig({
      ...defaultConfig(),
      kind: 'villa',
      shape: 'rectangle',
      width: 14,
      depth: 12,
      plotW: 30,
      plotD: 36,
      storeys: 2,
      groundHeight: 2.9,
    });
    const { intent } = offlineIntent('3 bedroom family home', 0, { villa: false });
    const plan = solveLayout({
      intent,
      footprint: base.shell.footprint,
      entrance: base.shell.entrance,
      plumbing: [],
      columns: [],
      maxHeight: base.shell.maxHeight,
      plot: base.site.plot,
    });
    const p = produce(base, (d) => void applyPlan(d, plan, intent.style));
    expect(p.levels).toHaveLength(2);
    expect(p.stairs).toHaveLength(1);
  });

  it('an empty apartment project is untouched by any of this', () => {
    const p = createEmptyProject();
    expect(p.kind).toBe('apartment');
    expect(
      runChecks(p).filter((i) =>
        ['setback', 'gate-parking', 'gate-path', 'pool-safety', 'garage-exterior'].includes(i.rule),
      ),
    ).toHaveLength(0);
  });
});
