import type { DesignBrief } from '../model/types';
import type { LayoutPlan } from '../ai/layout/plan';
import { rectArea } from '../ai/layout/plan';
import { allocateLevels, regularBedrooms } from './brief';

export interface AdherenceCheck {
  id: string;
  ok: boolean;
  text: string;
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * How well a plan follows the brief, checked by code (never by the model): the requested number of levels and
 * bedrooms, every "must" room present, its size within tolerance of what was asked once the whole plan is scaled to
 * the shell, and every requested outdoor feature on the plot.
 */
export function adherence(
  brief: DesignBrief,
  plan: LayoutPlan,
  opts: { sizeTolerance?: number } = {},
): { score: number; checks: AdherenceCheck[] } {
  const tol = opts.sizeTolerance ?? 0.45;
  const checks: AdherenceCheck[] = [];
  const add = (id: string, ok: boolean, text: string) => checks.push({ id, ok, text });
  const planRooms = plan.rooms.filter(
    (r) => !r.void && r.type !== 'stair' && r.type !== 'corridor' && r.type !== 'outdoor',
  );

  add('levels', plan.levelNames.length === Math.max(1, brief.levels), `${brief.levels} level(s)`);

  const wantBeds = regularBedrooms(brief.program).length;
  const haveBeds = regularBedrooms(planRooms).length;
  add('bedrooms', haveBeds === wantBeds, `${wantBeds} bedroom(s), plan has ${haveBeds}`);

  // The plan scales every room to fill the shell, so compare shares, not absolute areas.
  const musts = brief.program.filter((r) => r.priority === 'must');
  const briefTotal = brief.program.reduce((s, r) => s + r.area, 0) || 1;
  const planTotal = planRooms.reduce((s, r) => s + rectArea(r.rect), 0) || 1;
  const scale = planTotal / briefTotal;
  const alloc = allocateLevels(brief);
  for (const r of musts) {
    const level = Math.min(alloc.get(r.id) ?? 0, plan.levelNames.length - 1);
    const match =
      planRooms.find((p) => key(p.name) === key(r.name)) ??
      planRooms.find(
        (p) =>
          p.type === r.type &&
          p.level === level &&
          !musts.some((m) => m !== r && key(m.name) === key(p.name)),
      );
    if (!match) {
      add(`room:${r.id}`, false, `${r.name} is missing`);
      continue;
    }
    add(`room:${r.id}`, true, `${r.name} is there`);
    // Size: within tolerance of the asked area, scaled to the shell (circulation and tiny rooms are exempt).
    if (
      r.area >= 6 &&
      !['bathroom', 'walk-in-closet', 'utility', 'pantry', 'foyer', 'sauna'].includes(r.type)
    ) {
      const want = r.area * scale;
      const got = rectArea(match.rect);
      add(
        `size:${r.id}`,
        got >= want * (1 - tol) && got <= want * (1 + tol * 1.6),
        `${r.name} is ${Math.round(got)} m² (asked about ${Math.round(want)})`,
      );
    }
  }
  for (const f of brief.features.filter((x) => x.priority === 'must' && x.type !== 'path')) {
    const present = plan.site?.zones.some((z) => z.type === f.type) ?? false;
    add(`feature:${f.type}`, present, `${f.type} on the plot`);
  }
  if (brief.cars > 0) {
    const cars = plan.site?.items.filter((i) => i.catalogId === 'car').length ?? 0;
    add(
      'cars',
      cars >= Math.min(brief.cars, 2),
      `parking holds ${cars} car(s), wanted ${brief.cars}`,
    );
  }
  const ok = checks.filter((c) => c.ok).length;
  return { score: checks.length ? ok / checks.length : 1, checks };
}
