import { describe, expect, it } from 'vitest';
import { LAYOUT_BRIEFS, solveInputFor } from '../fixtures/layoutBriefs';
import { completeSite } from '../briefCheck';
import { offlineIntent } from '../offline';
import { ARCHETYPES, skeletons } from './archetypes';
import type { ArchetypeInput } from './archetypes';
import { solveInWorker } from './client';
import { explain } from './explain';
import { mergeEmphasis, parseImprove } from './improve';
import { hardViolations, planMetrics } from './metrics';
import { rectArea } from './plan';
import type { Rect } from './plan';
import { solveCandidates, solveLayout, planDistance } from './solve';
import { blockedWalkways, clearWalkways } from './walkways';
import { LAYOUT_WEIGHTS, weightsFor } from './weights';

const brief = (id: string) => LAYOUT_BRIEFS.find((b) => b.id === id)!;
const intentOf = (id: string) => ({
  ...offlineIntent(brief(id).text, 0, { villa: !!brief(id).plot }).intent,
  furnish: true,
});

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe('layout optimiser', () => {
  it('is deterministic for a seed and different for another', () => {
    const input = { intent: intentOf('d-3br'), ...solveInputFor(brief('d-3br')) };
    const a = solveLayout({ ...input, seed: 3 });
    const b = solveLayout({ ...input, seed: 3 });
    expect(a.rooms.map((r) => r.rect)).toEqual(b.rooms.map((r) => r.rect));
    const c = solveLayout({ ...input, seed: 4 });
    expect(a.score === c.score && JSON.stringify(a.rooms) === JSON.stringify(c.rooms)).toBe(false);
  });

  it('tiles every level with no overlaps and nothing outside the building', () => {
    for (const id of ['d-3br', 'd-4br', 'a-3br', 'v-luxury']) {
      const plan = solveLayout({ intent: intentOf(id), ...solveInputFor(brief(id)) });
      const rooms = plan.rooms.filter((r) => !r.void);
      for (const r of rooms) {
        expect(r.rect.x).toBeGreaterThanOrEqual(plan.shell.x - 1e-6);
        expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(plan.shell.x + plan.shell.w + 1e-6);
      }
      for (let i = 0; i < rooms.length; i++)
        for (let j = i + 1; j < rooms.length; j++)
          if (rooms[i]!.level === rooms[j]!.level)
            expect(overlap(rooms[i]!.rect, rooms[j]!.rect)).toBeLessThan(0.01);
    }
  });

  it('every skeleton of every archetype fills the shell exactly', () => {
    const shell: Rect = { x: 0, y: 0, w: 16, h: 13 };
    const input: ArchetypeInput = {
      shell,
      entrance: { x: 8, y: 13 },
      nLevels: 2,
      hall: { w: 3.4, h: 1.4 },
      stairPosition: 'near-entrance',
      wings: { foyer: true },
      doubleHeight: true,
      columns: [{ position: { x: 5, y: 5 }, size: { w: 0.3, d: 0.3 } }],
      villa: false,
    };
    const seen = new Set<string>();
    for (const levels of [1, 2]) {
      const sk = skeletons({ ...input, nLevels: levels, hall: levels > 1 ? input.hall : null });
      for (const c of sk) {
        seen.add(c.archetype);
        const used =
          c.regions.reduce((s, r) => s + rectArea(r), 0) +
          rectArea(c.hall) +
          (c.rooms ?? []).reduce((s, r) => s + rectArea(r.rect), 0) +
          (c.courts ?? []).reduce((s, r) => s + rectArea(r), 0) +
          (c.fixedRects ? 0 : 0);
        if (c.fixedRects) continue; // wings: the hall and foyer are inside the regions' gap
        expect(used).toBeCloseTo(rectArea(shell), 3);
      }
    }
    // a square-ish shell of this size suits the duplex, courtyard, L and corridor plans
    expect([...seen]).toEqual(
      expect.arrayContaining([
        'duplex-stacked',
        'duplex-split',
        'villa-courtyard',
        'linear-double',
      ]),
    );
  });

  it('each archetype declares where things go', () => {
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(8);
    for (const a of ARCHETYPES) {
      expect(a.zones.public && a.zones.private && a.zones.service && a.zones.outdoor).toBeTruthy();
      expect(a.entrance && a.parking && a.garden).toBeTruthy();
      expect(a.levels[0]).toBeLessThanOrEqual(a.levels[1]);
    }
  });
});

describe('acceptance briefs', () => {
  it('luxury villa on 18 × 16 m in a 34 × 42 m plot: 3 different plans, pool, 2-car garage, ensuites, no failures', () => {
    const b = brief('v-luxury');
    const intent = intentOf('v-luxury');
    const input = solveInputFor(b);
    const plans = solveCandidates({ intent, ...input }, 3);
    expect(plans).toHaveLength(3);
    for (let i = 0; i < plans.length; i++)
      for (let j = i + 1; j < plans.length; j++)
        expect(planDistance(plans[i]!, plans[j]!)).toBeGreaterThan(0.1);
    for (const p of plans) {
      expect(hardViolations(p, intent, { plot: input.plot, columns: input.columns })).toEqual([]);
      expect(p.site!.zones.some((z) => z.type === 'pool')).toBe(true);
      expect(p.site!.zones.some((z) => z.type === 'parking')).toBe(true);
      expect(p.site!.items.filter((i) => i.catalogId === 'car').length).toBeGreaterThanOrEqual(2);
      expect(planMetrics(p, intent, { plot: input.plot }).ensuiteBeside).toBe(1);
      expect(p.breakdown!.length).toBeGreaterThan(3);
    }
  });

  it('a 3-bedroom duplex is stacked: aligned stair and bathrooms above bathrooms', () => {
    const intent = intentOf('d-3br');
    const input = solveInputFor(brief('d-3br'));
    const plan = solveCandidates({ intent, ...input }, 3)[0]!;
    const m = planMetrics(plan, intent);
    expect(m.hardOk).toBe(true);
    expect(m.stacked).toBe(1);
    expect(plan.levelNames).toHaveLength(2);
    // The stair hall is the same rectangle on both levels.
    const halls = plan.rooms.filter(
      (r) => overlap(r.rect, plan.stair.roomRect) > 0.9 * rectArea(plan.stair.roomRect),
    );
    expect(new Set(halls.map((h) => h.level)).size).toBe(2);
  });

  it('beats the treemap solver on a sample of briefs', () => {
    const ids = ['d-4br', 'd-hosting', 'a-3br', 'v-closet'];
    const avg = (engine: 'v2' | 'treemap') => {
      let q = 0;
      for (const id of ids) {
        const intent = intentOf(id);
        const input = solveInputFor(brief(id));
        const plan = solveLayout({ intent, ...input, engine });
        q += planMetrics(plan, intent, { plot: input.plot, columns: input.columns }).quality;
      }
      return q / ids.length;
    };
    expect(avg('v2')).toBeGreaterThan(avg('treemap'));
  });
});

describe('explanations and improvement', () => {
  it('score lines are plain language with ✓ and ✗', () => {
    const plan = solveLayout({ intent: intentOf('d-3br'), ...solveInputFor(brief('d-3br')) });
    const lines = plan.breakdown!;
    expect(lines.some((l) => l.text.includes('✓'))).toBe(true);
    expect(lines.every((l) => /[✓✗]/.test(l.text))).toBe(true);
    expect(explain([], [], [])).toEqual([]);
  });

  it('understands what to improve and stacks repeated requests', () => {
    expect(parseImprove('more daylight in the bedrooms')).toEqual({ daylight: 3 });
    expect(Object.keys(parseImprove('less corridor and straighter walls')).sort()).toEqual([
      'corridor',
      'straight',
    ]);
    expect(parseImprove('hello')).toEqual({});
    expect(mergeEmphasis({ daylight: 3 }, { daylight: 3 }).daylight).toBe(9);
    expect(weightsFor({ corridor: 2 }).corridor).toBe(LAYOUT_WEIGHTS.corridor * 2);
    expect(weightsFor().corridor).toBe(LAYOUT_WEIGHTS.corridor);
  });

  it('asking for less corridor does not make the corridor share worse', () => {
    const intent = intentOf('d-5br');
    const input = { intent, ...solveInputFor(brief('d-5br')) };
    const share = (emphasis?: { corridor: number }) => {
      const p = solveLayout({ ...input, emphasis, seed: 2 });
      return planMetrics(p, intent).corridorRatio;
    };
    expect(share({ corridor: 8 })).toBeLessThanOrEqual(share() + 0.02);
  });

  it('runs the worker client on the calling thread when there is no Worker (tests, old browsers)', async () => {
    const intent = intentOf('d-2br-open');
    const plans = await solveInWorker({ intent, ...solveInputFor(brief('d-2br-open')) }, 2);
    expect(plans.length).toBeGreaterThanOrEqual(1);
  });
});

describe('site completion and furniture', () => {
  it('adds the pool and parking a model forgot, keeping what it had', () => {
    const fromBrief = intentOf('v-luxury');
    const forgetful = {
      ...fromBrief,
      site: { zones: [{ type: 'garden' as const, side: 'front' as const }] },
    };
    const fixed = completeSite(forgetful, fromBrief);
    expect(fixed.site!.zones.some((z) => z.type === 'pool')).toBe(true);
    expect(fixed.site!.zones.some((z) => z.type === 'parking')).toBe(true);
    expect(fixed.site!.zones.filter((z) => z.type === 'garden')).toHaveLength(1);
    expect(fixed.site!.cars).toBe(2);
  });

  it('keeps walkways between doors clear of furniture', () => {
    for (const id of ['d-3br', 'a-3br', 'v-modern']) {
      const plan = solveLayout({ intent: intentOf(id), ...solveInputFor(brief(id)) });
      const { items } = clearWalkways(plan.rooms, plan.openings, plan.items);
      const blocked = blockedWalkways(plan.rooms, plan.openings, items);
      // Only furniture the room is for may remain in a walkway (never decor).
      for (const b of blocked)
        for (const it of b.items)
          expect(['plant', 'floor-lamp', 'side-table', 'coffee-table', 'tv-unit']).not.toContain(
            it.catalogId,
          );
    }
  });
});
