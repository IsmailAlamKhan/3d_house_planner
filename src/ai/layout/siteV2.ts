import { polygonBounds } from '../../geometry/polygon';
import type { ZoneType } from '../../model/types';
import type { SiteSide, SiteZoneIntent } from '../schemas';
import { rng } from './rect';
import { type PlannedSite, type SitePlanInput, planSite } from './site';

/**
 * Site planner v2: the same plot planner, but the side of the building each outdoor zone goes on is searched
 * instead of taken on trust. The brief's sides are the starting point; a zone moves only when its side has no room
 * (the pool or the parking bay used to vanish with a warning) or when another side suits it clearly better.
 * Annealing over the assignments, scored on what makes a plot work: every zone placed, the pool and the lounge on the
 * garden side, cars at the front near the gate, play areas away from the street, no big strip left bare.
 */

const SIDES: SiteSide[] = ['front', 'back', 'left', 'right'];

/** How well a zone type likes each side (0 = ideal). */
const LIKES: Record<ZoneType, Record<SiteSide, number>> = {
  pool: { front: 12, back: 0, left: 3, right: 3 },
  deck: { front: 10, back: 0, left: 2, right: 2 },
  patio: { front: 8, back: 0, left: 2, right: 2 },
  parking: { front: 0, back: 14, left: 3, right: 3 },
  play: { front: 9, back: 0, left: 1, right: 1 },
  garden: { front: 0, back: 0, left: 0, right: 0 },
  lawn: { front: 2, back: 0, left: 0, right: 0 },
  path: { front: 0, back: 0, left: 0, right: 0 },
  'water-feature': { front: 0, back: 1, left: 2, right: 2 },
};

/** Zones that belong together on the same side as the pool (a deck beside it). */
const WITH_POOL: ZoneType[] = ['deck'];

function score(input: SitePlanInput, zones: SiteZoneIntent[], requested: SiteSide[]) {
  const site = planSite({ ...input, intent: { ...input.intent, zones } });
  let s = site.warnings.length * 30;
  zones.forEach((z, i) => {
    s += LIKES[z.type][z.side];
    if (z.side !== requested[i]) s += 2;
    // Every requested zone must exist on the plot.
    if (!site.zones.some((p) => p.type === z.type)) s += 60;
  });
  // The deck sits next to its pool.
  const pool = zones.find((z) => z.type === 'pool');
  for (const z of zones) if (pool && WITH_POOL.includes(z.type) && z.side !== pool.side) s += 6;
  // Cars must fit.
  const cars = input.intent.cars ?? 2;
  if (zones.some((z) => z.type === 'parking')) {
    const placed = site.items.filter((i) => i.catalogId === 'car').length;
    s += Math.max(0, Math.min(cars, 2) - placed) * 25;
  }
  return { s, site };
}

/** Fills big empty strips with a lawn so the plot never looks unfinished. */
function withLawns(input: SitePlanInput, zones: SiteZoneIntent[]): SiteZoneIntent[] {
  const P = polygonBounds(input.plot);
  const B = input.building;
  // Strip areas by plan side, then by side relative to the entrance (the front is where the entrance faces).
  const plan = {
    N: (P.max.x - P.min.x) * Math.max(0, B.y - P.min.y),
    S: (P.max.x - P.min.x) * Math.max(0, P.max.y - (B.y + B.h)),
    W: Math.max(0, B.x - P.min.x) * B.h,
    E: Math.max(0, P.max.x - (B.x + B.w)) * B.h,
  };
  const nx = Math.cos(input.entrance.direction);
  const ny = Math.sin(input.entrance.direction);
  const face = Math.abs(ny) >= Math.abs(nx) ? (ny >= 0 ? 'S' : 'N') : nx >= 0 ? 'E' : 'W';
  const OF = {
    S: { front: 'S', back: 'N', left: 'W', right: 'E' },
    N: { front: 'N', back: 'S', left: 'E', right: 'W' },
    E: { front: 'E', back: 'W', left: 'S', right: 'N' },
    W: { front: 'W', back: 'E', left: 'N', right: 'S' },
  } as const;
  const strips = Object.fromEntries(SIDES.map((side) => [side, plan[OF[face][side]]])) as Record<
    SiteSide,
    number
  >;
  const out = zones.slice();
  for (const side of SIDES)
    if (strips[side] >= 40 && !zones.some((z) => z.side === side))
      out.push({ type: 'lawn', side, covered: false });
  return out;
}

export function planSiteV2(input: SitePlanInput, seed = 1): PlannedSite {
  const base = input.intent.zones.filter((z) => z.type !== 'path');
  const requested = base.map((z) => z.side);
  const rnd = rng(seed * 7919);
  let cur = base.map((z) => ({ ...z }));
  let curScore = score(input, cur, requested);
  let best = { zones: cur, ...curScore };
  const movable = cur
    .map((z, i) => (z.type === 'lawn' || z.type === 'garden' ? -1 : i))
    .filter((i) => i >= 0);
  const steps = 160;
  for (let it = 0; it < steps && movable.length; it++) {
    const temp = 12 * Math.pow(0.05, it / steps);
    const next = cur.map((z) => ({ ...z }));
    const roll = rnd();
    const i = movable[Math.floor(rnd() * movable.length)]!;
    if (roll < 0.7) next[i]!.side = SIDES[Math.floor(rnd() * 4)]!;
    else {
      const j = movable[Math.floor(rnd() * movable.length)]!;
      [next[i]!.side, next[j]!.side] = [next[j]!.side, next[i]!.side];
    }
    const e = score(input, next, requested);
    if (e.s <= curScore.s || rnd() < Math.exp(-(e.s - curScore.s) / temp)) {
      cur = next;
      curScore = e;
      if (e.s < best.s) best = { zones: next, ...e };
    }
  }
  // Re-plan with the lawns for empty strips; keep it only if nothing got worse.
  const lawned = withLawns(input, best.zones);
  if (lawned.length === best.zones.length) return best.site;
  const again = planSite({ ...input, intent: { ...input.intent, zones: lawned } });
  return again.warnings.length <= best.site.warnings.length ? again : best.site;
}
