import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { ProjectSchema } from '../model/schemas';
import { applyPlan } from './layout/apply';
import { solveLayout } from './layout/solve';
import { offlineIntent } from './offline';

const sample = createSampleProject();
const build = (brief: string, variation = 0) => {
  const { intent, understood } = offlineIntent(brief, variation);
  const plan = solveLayout({
    intent,
    footprint: sample.shell.footprint,
    entrance: sample.shell.entrance,
    plumbing: sample.shell.fixedPlumbingPoints,
    columns: sample.columns
      .filter((c) => c.levelId === sample.levels[0]!.id)
      .map((c) => ({ position: c.position, size: c.size })),
    maxHeight: sample.shell.maxHeight,
  });
  const project = produce(sample, (d) => void applyPlan(d, plan, intent.style));
  return { intent, understood, plan, project };
};
const names = (i: ReturnType<typeof offlineIntent>['intent'], level: number) =>
  i.levels[level]!.rooms.map((r) => r.name);

describe('offline generator', () => {
  it('"2 bedroom duplex with open kitchen" → a valid two-level model with stairs, doors and windows', () => {
    const { intent, project, plan } = build('2 bedroom duplex with open kitchen');
    expect(intent.levels).toHaveLength(2);
    expect(intent.levels[1]!.rooms.filter((r) => r.type === 'bedroom')).toHaveLength(2);
    const kitchen = intent.levels[0]!.rooms.find((r) => r.name === 'Kitchen')!;
    expect(intent.levels[0]!.rooms.find((r) => r.name === 'Living room')!.adjacency).toContainEqual(
      { room: 'Kitchen', connection: 'open' },
    );
    expect(kitchen.needsPlumbing).toBe(true);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
    expect(project.levels).toHaveLength(2);
    expect(project.stairs).toHaveLength(1);
    expect(project.openings.filter((o) => o.kind === 'door').length).toBeGreaterThanOrEqual(6);
    expect(project.openings.filter((o) => o.kind === 'window').length).toBeGreaterThanOrEqual(4);
    // The open-plan link between living room and kitchen is an archway, not a door.
    expect(plan.openings.some((o) => o.kind === 'archway')).toBe(true);
  });

  it('reads counts, number words and extras', () => {
    const { intent, understood } = build(
      'Three bed, 3 baths, home office, utility room and a balcony, scandinavian style',
    );
    expect(intent.levels[1]!.rooms.filter((r) => r.type === 'bedroom')).toHaveLength(3);
    expect(intent.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bathroom')).toHaveLength(
      3,
    );
    expect(names(intent, 0)).toEqual(expect.arrayContaining(['Study', 'Utility']));
    expect(names(intent, 1)).toContain('Balcony');
    expect(intent.style).toEqual({ floor: 'light-wood', walls: 'white' });
    expect(understood.length).toBeGreaterThan(3);
  });

  it('handles people counts, family, studio and style words', () => {
    expect(
      offlineIntent(
        'something cozy for 2 people with a home office',
      ).intent.levels[1]!.rooms.filter((r) => r.type === 'bedroom'),
    ).toHaveLength(1);
    expect(
      offlineIntent('family home').intent.levels[1]!.rooms.filter((r) => r.type === 'bedroom'),
    ).toHaveLength(3);
    const studio = offlineIntent('a bright studio, unfurnished').intent;
    expect(studio.levels.some((l) => l.rooms.some((r) => r.type === 'bedroom'))).toBe(false);
    expect(studio.furnish).toBe(false);
    expect(offlineIntent('dark industrial loft with a spiral staircase').intent).toMatchObject({
      stair: { type: 'spiral' },
      style: { floor: 'concrete', walls: 'charcoal' },
    });
    expect(
      offlineIntent('4 bedroom house, en-suite master').intent.levels[1]!.rooms.find(
        (r) => r.name === 'Master bedroom',
      )!.adjacency,
    ).toHaveLength(1);
  });

  it('copes with an empty or nonsense brief by using the default duplex', () => {
    for (const brief of ['', '   ', 'asdf qwer']) {
      const { intent, project } = build(brief);
      expect(intent.levels.length).toBe(2);
      expect(ProjectSchema.safeParse(project).success).toBe(true);
    }
  });

  it('variations differ but stay valid', () => {
    const base = build('3 bedroom duplex with study', 0);
    const v1 = build('3 bedroom duplex with study', 1);
    const v2 = build('3 bedroom duplex with study', 2);
    expect(JSON.stringify(v1.intent)).not.toEqual(JSON.stringify(base.intent));
    expect(JSON.stringify(v2.intent)).not.toEqual(JSON.stringify(v1.intent));
    expect(names(v1.intent, 1)).toContain('Study'); // the study moved upstairs in variation 1
    for (const v of [base, v1, v2]) expect(ProjectSchema.safeParse(v.project).success).toBe(true);
  });

  it('every brief in a mixed bag produces a complete layout with no unreachable rooms', () => {
    for (const brief of [
      '1 bedroom flat',
      '2 bed 1 bath open plan modern',
      '4 bedrooms 3 bathrooms dining utility study balcony',
      'luxury marble villa 3 bedroom en-suite',
      'guest room downstairs and 2 bedrooms upstairs',
    ]) {
      const { plan } = build(brief);
      expect(plan.rooms.length).toBeGreaterThanOrEqual(6);
      expect(plan.warnings.filter((w) => /could not be reached/.test(w))).toEqual([]);
    }
  });
});
